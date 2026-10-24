// replicate.mjs — INDEPENDENT replication of the demand split on a DIFFERENT sample.
//
// Why: the 15:34Z measurement (verify3, n=200, stride 116) overturned the 13:25Z
// headline (75.28% zombie -> 12.89% dead of decided). A 6-point swing class of
// claim needs a second, non-overlapping draw before it may go on a card.
//
// Sample: from THIS beat's matched pairs (matched.json, 13:00Z run, 23267 pairs).
// verify3 sampled stride 116 offset 0 over the sorted list; this pass takes
// stride 113 offset 57 -> indices 57, 170, 283, ... then any row that
// collides with the verify3 sample is DROPPED (measured: 57+113*19 == 116*19,
// so a naive modular argument would have been wrong).
// Endpoint identical: api.mainnet-beta.solana.com ONLY, patient backoff.
import fs from 'node:fs';

const OUT = '/tmp/demand1234';
const MAIN = 'https://api.mainnet-beta.solana.com';
const N = 200, STRIDE = 113, OFFSET = 57;
let calls = 0, throttles = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rpc(method, params, tries = 12) {
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
async function tryTx(sig) {
  for (let i = 0; i < 6; i++) {
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

const popRows = JSON.parse(fs.readFileSync(`${OUT}/matched.json`, 'utf8'))
  .map(r => ({ pd: r.pd, prog: r.prog, last_deploy_slot: r.slot }));
if (!Array.isArray(popRows) || popRows.length < 1000) throw new Error('GUARD: matched pairs degenerate');
// v3 sample is read FIRST so the disjoint filter can use it.
const v3 = fs.readFileSync(`${OUT}/demand-rows.jsonl`, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const v3pds = new Set(v3.map(r => r.pd));

const targets = [];
for (let i = OFFSET; targets.length < N && i < popRows.length; i += STRIDE) {
  const r = popRows[i];
  if (!v3pds.has(r.pd)) targets.push({ pd: r.pd, prog: r.prog, last_deploy_slot: r.last_deploy_slot });
  // BUG-CHECK (caught before posting anything): the first run pushed r.slot
  // after the mapping renamed it to last_deploy_slot -> undefined,
  // so `slot > undefined` was always false and every row landed on
  // `silent_since_deploy` (61/61). A deploy slot guard now throws.
}
if (targets.length !== N) throw new Error(`GUARD: sample ${targets.length} != ${N} after disjoint filtering`);
// GUARD (added after the undefined-deploy-slot bug): every target must carry a
// numeric deploy slot, else `slot > undefined` silently yields "no activity".
const badSlot = targets.filter(t => !Number.isFinite(t.last_deploy_slot) || t.last_deploy_slot <= 0);
if (badSlot.length) throw new Error(`GUARD: ${badSlot.length} targets without a deploy slot — abort`);

// overlap check against the verify3 sample
// NOTE: the naive claim "57 + 113k != 116m" was WRONG (57+113*19 == 116*19);
// that is why the filter above exists. This guard must MEASURE zero.
const overlap = targets.filter(t => v3pds.has(t.pd)).length;
console.log(`sample: n=${targets.length} stride=${STRIDE} offset=${OFFSET} | overlap with verify3 sample: ${overlap}`);
if (overlap !== 0) throw new Error(`GUARD: samples overlap on ${overlap} pds — not independent`);

const ROWS_JL = `${OUT}/replicate-rows.jsonl`;
const done = new Map();
if (fs.existsSync(ROWS_JL)) for (const l of fs.readFileSync(ROWS_JL, 'utf8').split('\n')) {
  if (!l.trim()) continue; try { const r = JSON.parse(l); done.set(r.pd, r); } catch {}
}
console.log(`replicate start, resume ${done.size}/${N}`);
const T0 = Date.now();

async function txKind(prog, tx) {
  const keys = tx?.transaction?.message?.accountKeys || [];
  const pidOf = ix => ix.programId || (typeof ix.programIdIndex === 'number' ? (keys[ix.programIdIndex]?.pubkey || keys[ix.programIdIndex]) : undefined);
  if ((tx?.transaction?.message?.instructions || []).some(ix => pidOf(ix) === prog)) return 'top';
  const inner = (tx?.meta?.innerInstructions || []).flatMap(x => x.instructions || []);
  if (inner.some(ix => pidOf(ix) === prog)) return 'cpi';
  return 'touch';
}



const CONC = Number(process.env.CONC || 4);
const GAP = Number(process.env.GAP || 400);
let next = 0, finished = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (true) {
    const i = next++;
    if (i >= targets.length) return;
    const t = targets[i];
    if (done.has(t.pd)) { finished++; continue; }
    const out = { pd: t.pd, prog: null, last_deploy_slot: t.last_deploy_slot, class: null, note: null };
    try {
      const prog = t.prog;
      if (!prog) { out.class = 'history_unavailable'; out.note = 'no program id from pairs'; }
      else {
        out.prog = prog;
        const sigs = await rpc('getSignaturesForAddress', [prog, { limit: 1000, commitment: 'finalized' }]);
        if (!Array.isArray(sigs)) { out.class = 'history_unavailable'; out.note = 'sig shape'; }
        else {
          const after = sigs.filter(s => s.slot > t.last_deploy_slot);
          out.main_total = sigs.length; out.main_after = after.length;
          if (after.length === 0) {
            await sleep(600);
            let s2 = null;
            try { s2 = await rpc('getSignaturesForAddress', [prog, { limit: 1000, commitment: 'finalized' }]); } catch {}
            const a2 = Array.isArray(s2) ? s2.filter(s => s.slot > t.last_deploy_slot) : null;
            if (!a2) { out.class = 'history_unavailable'; out.note = 'second sig failed'; }
            else if (a2.length) { out.class = 'has_after_activity'; out.main_after = a2.length; }
            else { out.class = 'silent_since_deploy'; out.note = 'double-empty mainnet-beta'; }
          } else {
            const ok = after.filter(s => s.err === null || s.err === undefined);
            out.after_ok = ok.length; out.after_failed = after.length - ok.length;
            if (ok.length === 0) { out.class = 'no_success_after_deploy'; out.note = `all ${after.length} post-deploy failed`; out.sample_err = after[0].err; }
            else {
              const PROBE_N = Math.min(8, ok.length);
              let top = 0, cpi = 0, touch = 0, unreadable = 0;
              for (let k = 0; k < PROBE_N; k++) {
                const tx = await tryTx(ok[k].signature);
                if (!tx || !tx.meta) { unreadable++; continue; }
                const kind = await txKind(prog, tx);
                if (kind === 'top') top++; else if (kind === 'cpi') cpi++; else touch++;
                if (kind === 'top') break;
              }
              if (top > 0) { out.class = 'active_top_level_success'; out.evidence_sig = ok[0].signature; }
              else if (unreadable === PROBE_N && PROBE_N > 0) { out.class = 'history_unavailable'; out.note = 'all probes unreadable'; }
              else if (ok.length <= PROBE_N) { out.class = 'no_success_all_probed'; out.note = `all ${ok.length} successful post-deploy txs probed, none top-level`; }
              else { out.class = 'no_success_spread_probed'; out.note = `${ok.length} successful post-deploy txs, ${PROBE_N} probed, none top-level`; }
            }
          }
        }
      }
    } catch (e) { out.class = 'history_unavailable'; out.note = 'fatal ' + String(e.message).slice(0, 100); }
    fs.appendFileSync(ROWS_JL, JSON.stringify(out) + '\n');
    done.set(t.pd, out);
    finished++;
    await sleep(GAP);
    if (finished % 25 === 0) console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${finished}/${N} last=${t.pd.slice(0, 8)} -> ${out.class} (calls ${calls}, thr ${throttles})`);
  }
}));

const rows = fs.readFileSync(ROWS_JL, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const last = new Map(rows.map(r => [r.pd, r]));
const counts = {};
for (const r of last.values()) counts[r.class] = (counts[r.class] || 0) + 1;
console.log('REPLICATE CLASSES:', JSON.stringify(counts), '| calls', calls, 'throttles', throttles);
