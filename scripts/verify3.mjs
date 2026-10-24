// verify2.mjs — authoritative demand verification, api.mainnet-beta.solana.com ONLY.
//
// Fixes two measured defects of the earlier passes in this same beat:
//  (1) leorpc returns result:[] for getSignaturesForAddress on addresses that
//      mainnet-beta answers with data (measured on 3 addresses) -> every
//      "silent" claim from the mixed-pool run is suspect.
//  (2) getTransaction on mainnet-beta is heavily 429-limited; retry storms cost
//      ~30 s per null tx and made the pass unfinishable.
//
// KEY COST FIX: getSignaturesForAddress already returns each transaction's
// execution result in the `err` field (null = the transaction succeeded).
// So "was there a SUCCESSFUL transaction touching this program after its
// deploy" is answerable from ONE signature call, with no getTransaction at all.
// getTransaction is used only where the signature metadata cannot decide:
//   - to separate top-level invocation from CPI-only / account-key mention
//   - to confirm a success that the signature `err` field already suggests
//
// FINAL CLASSES (per program):
//  active_top_level_success : proven successful top-level invocation after deploy
//  active_cpi_success       : successful tx after deploy, program invoked only via CPI
//  active_touch_success     : successful tx after deploy touching the program (invocation unconfirmed)
//  no_success_after_deploy  : every post-deploy signature has err != null (all failed) => proven
//  no_success_all_probed    : post-deploy txs exist and succeeded, but none is a top-level
//                              invocation of this program (probed all of them)
//  silent_since_deploy      : zero post-deploy signatures on TWO independent mainnet calls
//  history_unavailable      : sources conflict, or probes could not be read
import fs from 'node:fs';

const MAIN = 'https://api.mainnet-beta.solana.com';
let calls = 0, throttles = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RPC_TRIES = Number(process.env.RPC_TRIES || 12);
async function rpc(method, params, tries = RPC_TRIES) {
  for (let i = 0; i < tries; i++) {
    calls++;
    try {
      const r = await fetch(MAIN, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (r.status === 429) { throttles++; await sleep(Math.min(30000, 2000 * (i + 1)) + Math.random() * 1500); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) {
        if (j.error.code === -32029 || j.error.code === -32005 || /too many|exceed|rate/i.test(String(j.error.message || ''))) { throttles++; await sleep(Math.min(30000, 2000 * (i + 1)) + Math.random() * 1500); continue; }
        throw new Error('rpc ' + j.error.code + ' ' + String(j.error.message).slice(0, 90));
      }
      return j.result;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(Math.min(30000, 1500 * (i + 1)));
    }
  }
  throw new Error('rpc failed: ' + method);
}
// tx fetch: cheap retries only, never storm
const TX_TRIES = Number(process.env.TX_TRIES || 6);
async function tryTx(sig) {
  for (let i = 0; i < TX_TRIES; i++) {
    calls++;
    try {
      const r = await fetch(MAIN, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 1 }] }) });
      if (r.status === 429) { throttles++; await sleep(Math.min(30000, 2500 * (i + 1)) + Math.random() * 1500); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      if (j.error) return null;
      return j.result || null;
    } catch { await sleep(700); }
  }
  return null;
}

const OUT = '/tmp/demand1234';
const ROWS_JL = `${OUT}/verify3-rows.jsonl`;
const v1rows = fs.readFileSync(`${OUT}/demand-rows.jsonl`, 'utf8').split('\n')
  .filter(l => l.trim()).map(l => JSON.parse(l));
if (v1rows.length !== 200) throw new Error(`GUARD: expected 200 v1 rows, got ${v1rows.length}`);

const done = new Map();
if (fs.existsSync(ROWS_JL)) {
  for (const l of fs.readFileSync(ROWS_JL, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r.prog) done.set(r.prog, r); } catch {}
  }
}
const RUN_T0 = Date.now();
const t = () => ((Date.now() - RUN_T0) / 1000).toFixed(0) + 's';
console.log(`verify2 start, resume ${done.size}/200`);

async function txKind(prog, tx) {
  const keys = tx?.transaction?.message?.accountKeys || [];
  const pidOf = ix => ix.programId || (typeof ix.programIdIndex === 'number' ? (keys[ix.programIdIndex]?.pubkey || keys[ix.programIdIndex]) : undefined);
  const top = (tx?.transaction?.message?.instructions || []).some(ix => pidOf(ix) === prog);
  if (top) return 'top';
  const inner = (tx?.meta?.innerInstructions || []).flatMap(x => x.instructions || []);
  if (inner.some(ix => pidOf(ix) === prog)) return 'cpi';
  return 'touch';
}

async function verifyOne(row) {
  const out = {
    prog: row.prog, pd: row.pd, last_deploy_slot: row.last_deploy_slot,
    v1_class: row.class, v1_mentions_total: row.mentions_total, v1_after: row.mentions_after_deploy,
    class: null, main_total: null, main_after: null,
    after_ok: 0, after_failed: 0, after_unknown: 0,
    newest_after_slot: null, oldest_after_slot: null,
    tx_probe: { tried: 0, top: 0, cpi: 0, touch: 0, unreadable: 0 },
    evidence: null, note: null,
  };
  let sigs = await rpc('getSignaturesForAddress', [row.prog, { limit: 1000, commitment: 'finalized' }]);
  if (!Array.isArray(sigs)) { out.class = 'history_unavailable'; out.note = 'sig shape'; return out; }
  const after = sigs.filter(s => s.slot > row.last_deploy_slot);
  out.main_total = sigs.length;
  out.main_after = after.length;
  if (after.length) {
    out.newest_after_slot = after[0].slot;
    out.oldest_after_slot = after[after.length - 1].slot;
    for (const s of after) {
      if (s.err === null || s.err === undefined) out.after_ok++;
      else if (s.err === 'BlockhashNotFound') out.after_unknown++;
      else out.after_failed++;
    }
  }
  // case A: no post-deploy signature at all
  if (after.length === 0) {
    await sleep(600);
    let sigs2 = null;
    try { sigs2 = await rpc('getSignaturesForAddress', [row.prog, { limit: 1000, commitment: 'finalized' }]); } catch {}
    const after2 = Array.isArray(sigs2) ? sigs2.filter(s => s.slot > row.last_deploy_slot) : null;
    if (!after2) { out.class = 'history_unavailable'; out.note = 'second sig call failed'; return out; }
    if (after2.length > 0) {
      out.note = 'sig_unstable: first call empty, second saw ' + after2.length + ' -> treat as active path';
      out.main_after = after2.length;
      for (const s of after2) { if (s.err === null || s.err === undefined) out.after_ok++; else out.after_failed++; }
      return finishActive(out, row, after2);
    }
    if (row.mentions_total === 0) { out.class = 'silent_since_deploy'; out.note = 'double-empty on mainnet-beta, v1 empty'; return out; }
    out.class = 'history_unavailable';
    out.note = `CONFLICT v1 saw ${row.mentions_total} mentions, mainnet-beta empty twice`;
    return out;
  }
  return finishActive(out, row, after);
}

async function finishActive(out, row, after) {
  const okSigs = after.filter(s => s.err === null || s.err === undefined);
  if (okSigs.length === 0) {
    // every post-deploy transaction FAILED -> proven no successful execution
    out.class = 'no_success_after_deploy';
    out.note = `all ${after.length} post-deploy signatures failed (err != null)`;
    out.evidence = { newest_failed_slot: after[0].slot, sample_err: after[0].err };
    return out;
  }
  // at least one successful post-deploy tx: probe to separate top/cpi/touch
  const PROBE_N = Math.min(8, okSigs.length);
  const probed = [];
  for (let i = 0; i < PROBE_N; i++) {
    const tx = await tryTx(okSigs[i].signature);
    out.tx_probe.tried++;
    if (!tx || !tx.meta) { out.tx_probe.unreadable++; continue; }
    const kind = await txKind(row.prog, tx);
    if (kind === 'top') out.tx_probe.top++;
    else if (kind === 'cpi') out.tx_probe.cpi++;
    else out.tx_probe.touch++;
    probed.push({ signature: okSigs[i].signature, slot: okSigs[i].slot, kind });
    if (kind === 'top') { out.class = 'active_top_level_success'; out.evidence = probed[probed.length - 1]; out.note = 'successful top-level invocation proven on mainnet-beta'; return out; }
  }
  if (out.tx_probe.top > 0) { out.class = 'active_top_level_success'; out.evidence = probed.find(p => p.kind === 'top'); out.note = 'top-level proven'; return out; }
  if (out.tx_probe.cpi > 0) { out.class = 'active_cpi_success'; out.evidence = probed.find(p => p.kind === 'cpi'); out.note = 'successful invocation via CPI only'; return out; }
  if (out.tx_probe.touch > 0) { out.class = 'active_touch_success'; out.evidence = probed.find(p => p.kind === 'touch'); out.note = 'successful tx touching program, invocation not confirmed'; return out; }
  // nothing readable
  if (out.tx_probe.unreadable === out.tx_probe.tried && out.tx_probe.tried > 0) {
    out.class = 'history_unavailable';
    out.note = `all ${out.tx_probe.tried} tx probes unreadable (rate limit)`;
    return out;
  }
  // every post-deploy successful tx probed, none is a top-level invocation
  if (okSigs.length <= PROBE_N) {
    out.class = 'no_success_all_probed';
    out.note = `all ${okSigs.length} successful post-deploy txs probed, none top-level`;
    return out;
  }
  out.class = 'no_success_spread_probed';
  out.note = `${okSigs.length} successful post-deploy txs, ${PROBE_N} probed, none top-level -> undecided`;
  return out;
}

const CONC = Number(process.env.CONC || 1);
const GAP = Number(process.env.GAP || 400);
let next = 0, finished = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (true) {
    const i = next++;
    if (i >= v1rows.length) return;
    const row = v1rows[i];
    let res = done.get(row.prog);
    if (!res) {
      try { res = await verifyOne(row); }
      catch (e) { res = { prog: row.prog, pd: row.pd, last_deploy_slot: row.last_deploy_slot, v1_class: row.class, class: 'history_unavailable', note: 'fatal ' + String(e.message).slice(0, 110) }; }
      fs.appendFileSync(ROWS_JL, JSON.stringify(res) + '\n');
    }
    await sleep(GAP);
    finished++;
    if (finished % 25 === 0) console.log(`[${t()}] ${finished}/200 last=${row.prog.slice(0, 8)} -> ${res.class} (calls ${calls}, thr ${throttles})`);
  }
}));

const rows = fs.readFileSync(ROWS_JL, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const last = new Map(rows.map(r => [r.prog, r]));
const counts = {};
for (const r of last.values()) counts[r.class] = (counts[r.class] || 0) + 1;
console.log('VERIFY2 CLASSES:', JSON.stringify(counts), '| calls', calls, 'throttles', throttles);
