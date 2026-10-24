// pop-tag.mjs — population re-derivation WITHOUT the memcmp tag filter.
//
// Context (card 80e3c517, 13:19Z beat): the population split
//   23,253 ProgramData / 78,518 Program  = 29.61% answerable
// was derived with memcmp filters on bytes[0:4]. memcmp has already produced one
// silent-zero defect this week (base58 vs hex encoding). A population number that
// will carry a stand-up claim must survive a query path that does NOT use the
// filter it was measured with.
//
// Read-only against mainnet RPC. No writes.
import fs from 'node:fs';

const RPC = 'https://api.mainnet-beta.solana.com';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111'; // BPFLoaderUpgradeable
const OUT = process.env.OUT || '/tmp/pop1408/out.json';
fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });

const b58chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf) {
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const byte of buf) { if (byte !== 0) break; out += '1'; }
  for (let i = digits.length - 1; i >= 0; i--) out += b58chars[digits[i]];
  return out;
}
const ELF_B58 = b58enc(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
const tagB58 = (n) => b58enc(Buffer.from([n, 0, 0, 0])); // u32 LE state

let calls = 0, errs = [], netRetries = 0;
async function rpc(method, params) {
  // Socket-level failures on huge responses ("other side closed") get their own
  // retry budget; 429 gets backoff. No silent nulls: if every attempt fails this throws.
  let lastErr = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    calls++;
    try {
      const r = await fetch(RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const text = await r.text();
      let j;
      try { j = JSON.parse(text); } catch (e) { lastErr = new Error(`unparseable body (${text.length} bytes): ${e.message}`); netRetries++; await new Promise(z => setTimeout(z, 4000 * (attempt + 1))); continue; }
      if (j.error && j.error.code === 429) { lastErr = new Error(JSON.stringify(j.error)); await new Promise(z => setTimeout(z, 5000 * (attempt + 1))); continue; }
      if (j.error) { errs.push({ method, error: j.error }); throw new Error(`${method}: ${JSON.stringify(j.error)}`); }
      return j.result;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith(method + ':')) throw e; // RPC-level error: loud, no retry
      lastErr = e; netRetries++;
      await new Promise(z => setTimeout(z, 4000 * (attempt + 1)));
    }
  }
  throw new Error(`${method}: network after 10 attempts: ${lastErr && lastErr.message}`);
}

const argv = process.argv.slice(2);
const only = (n) => argv.length === 0 || argv.includes(n);
const FIN = await rpc('getSlot', [{ commitment: 'finalized' }]);
console.log('finalized slot', FIN, new Date().toISOString());

// ---- H1: raw sweep, no filter at all, 4 bytes of state --------------------------
// dataSlice 0..4 keeps the payload ~6 bytes/base64 per account, so this stays
// transportable even at ~78k accounts. If the socket still dies, H1 is marked
// FAILED — it is not silently skipped.
const raw = await rpc('getProgramAccounts', [LOADER, {
  encoding: 'base64',
  dataSlice: { offset: 0, length: 4 },
}]);
const hist = {}; const short = []; const sets = {};
for (const { pubkey, account } of raw) {
  const b = Buffer.from(account.data[0], 'base64');
  if (b.length === 0) { hist['<4bytes'] = (hist['<4bytes'] || 0) + 1; short.push({ pubkey, space: account.space }); continue; }
  if (b.length !== 4) throw new Error(`H1: dataSlice returned ${b.length} bytes, not 4 — parser guard`);
  const v = b.readUInt32LE(0);
  hist[v] = (hist[v] || 0) + 1;
}
const rawTotal = raw.length;
const distinct = new Set(raw.map(r => r.pubkey)).size;
console.log('H1 rows', rawTotal, 'distinct', distinct, 'state histogram', JSON.stringify(hist));
if (short.length) console.log('H1 accounts with <4 bytes data (space histogram):', JSON.stringify(short.reduce((m, s) => (m[s.space] = (m[s.space] || 0) + 1, m), {})), 'first', short[0].pubkey);
if (rawTotal === 0) throw new Error('SILENT ZERO: unfiltered sweep returned 0 rows — abort before any judgement');

// ---- H2: same population, reached through four separate memcmp queries ---------
// Each is an independent path to the same denominator. tag 3 is the value the
// 13:19Z entry used for ProgramData; if it is not a real state, that entry's
// numerator was selected by something else than the state field.
const perTag = {};
for (const t of [0, 1, 2, 3]) {
  const rows = await rpc('getProgramAccounts', [LOADER, {
    encoding: 'base64',
    dataSlice: { offset: 0, length: 4 },
    filters: [{ memcmp: { offset: 0, bytes: tagB58(t) } }],
  }]);
  perTag[t] = rows.length;
  for (const r of rows) sets[t + ''] = sets[t + ''] || new Set(), sets[t + ''].add(r.pubkey);
  console.log(`H2 memcmp state=${t} (b58 "${tagB58(t)}") -> ${rows.length}`);
}
const tagSum = Object.values(perTag).reduce((a, b) => a + b, 0);
console.log('H2 sum', tagSum, 'vs H1 total', rawTotal, tagSum === rawTotal ? 'AGREE' : 'MISMATCH');

// ---- H3: PD identified by structure, not by state -----------------------------
// A Program account is 36 bytes; it cannot carry data at offset 45. A ProgramData
// account holding code has ELF magic at [45]. Counting ELF@45 selects the live
// code-bearing PDs without reference to the state byte at all.
const elfRows = await rpc('getProgramAccounts', [LOADER, {
  encoding: 'base64',
  dataSlice: { offset: 45, length: 4 },
  filters: [{ memcmp: { offset: 45, bytes: ELF_B58 } }],
}]);
console.log('H3 ELF@45 rows', elfRows.length, '(independently selected live code-bearing PDs)');

// ---- H4: what is actually at offset 45 for the state=2 set --------------------
// If the state=2 set mixes 36-byte Programs with large PDs, the state byte alone
// cannot carry the Program/ProgramData distinction the claim needs.
const s2 = await rpc('getProgramAccounts', [LOADER, {
  encoding: 'base64', dataSlice: { offset: 0, length: 4 },
  filters: [{ memcmp: { offset: 0, bytes: tagB58(2) } }],
}]);
const s2s = s2.map(r => r.pubkey);
if (s2s.length !== hist['2']) throw new Error(`H4 set ${s2s.length} != H1 state=2 count ${hist['2']}`);
const sample = []; // @ts-ignore
for (const pk of s2s.slice(0, 400)) sample.push(pk);
const lens = [];
for (let i = 0; i < sample.length; i += 100) {
  const res = await rpc('getMultipleAccounts', [sample.slice(i, i + 100), { encoding: 'base64' }]);
  for (const a of res.value) lens.push(a ? Buffer.from(a.data[0], 'base64').length : -1);
}
const lenHist = {};
for (const l of lens) lenHist[l] = (lenHist[l] || 0) + 1;
console.log('H4 state=2 length histogram (first 400):', JSON.stringify(lenHist));

const out = {
  at: new Date().toISOString(), finalizedSlot: FIN, calls,
  H1: { rows: rawTotal, distinct, stateHistogram: hist, sub4Bytes: short.slice(0, 20), sub4Count: short.length },
  H2: { perTag, sum: tagSum, setSizes: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size])) },
  H1_byH2_membership: (() => {
    // do the four memcmp buckets actually partition the raw sweep?
    const inTags = new Set();
    for (const s of Object.values(sets)) for (const pk of s) inTags.add(pk);
    const rawSet = new Set(raw.map(r => r.pubkey));
    const missingFromTags = [...rawSet].filter(pk => !inTags.has(pk)).length;
    const extraInTags = [...inTags].filter(pk => !rawSet.has(pk)).length;
    return { rawDistinct: rawSet.size, tagUnion: inTags.size, missingFromTags, extraInTags };
  })(),
  H3: { elfAt45: elfRows.length },
  H4: { sample: sample.length, lengthHistogram: lenHist },
  errors: errs,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('wrote', OUT, 'rpc calls', calls, 'errors', errs.length);