// CLASS TEST: does the ProgramData provenance layout hold for EVERY upgradeable
// program on mainnet, not just 7 hand-picked famous ones?
// Population = getProgramAccounts(BPFLoaderUpgradeab1e..., memcmp tag u32=3 at offset 0)
// i.e. every ProgramData account. dataSlice 0..49 gives:
//   [0:4] tag u32 | [4:12] last_deploy_slot u64 | [12] Option tag | [13:45] authority | [45:49] ELF magic
// Claims under test (from 12:34Z entry, n=7):
//   C1  opt tag always 0 or 1            -> so slot is at [4:12], not shifted
//   C2  ELF magic 0x7f454c46 always @45  -> so code offset is 45 regardless of authority
//   C3  last_deploy_slot < head slot     -> so the field is a real slot
// Read-only. No writes. No foreign interaction.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const RPC = 'https://api.mainnet-beta.solana.com';
const UPG = 'BPFLoaderUpgradeab1e11111111111111111111111';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf){let z=0;while(z<buf.length&&buf[z]===0)z++;let n=0n;for(const b of buf)n=n*256n+BigInt(b);let s='';while(n>0n){s=B58[Number(n%58n)]+s;n/=58n;}return '1'.repeat(z)+s;}
async function rpc(m, p, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) });
      if (r.status === 429) { console.error('429, backing off'); await new Promise(x => setTimeout(x, 3000 * (i + 1))); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) {
        if (j.error.code === -32005 || /too many|exceed/i.test(j.error.message || '')) { await new Promise(x => setTimeout(x, 2000)); continue; }
        throw new Error('rpc ' + j.error.code + ' ' + j.error.message);
      }
      return j.result;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(x => setTimeout(x, 2000 * (i + 1)));
    }
  }
  throw new Error('rpc failed after retries');
}

const head = await rpc('getSlot', [{ commitment: 'finalized' }]);
console.log('head slot:', head);
// memcmp bytes are base58-encoded, not hex: 03000000 LE -> 4Ju9dM... must be b58(0x03 00 00 00)
const TAG3_B58 = b58enc(Buffer.from([3, 0, 0, 0]));
console.log('tag3 memcmp bytes (b58):', TAG3_B58);
const res = await rpc('getProgramAccounts', [UPG, {
  commitment: 'finalized',
  encoding: 'base64',
  dataSlice: { offset: 0, length: 49 },
  filters: [{ memcmp: { offset: 0, bytes: TAG3_B58 } }],
}]);
const rows = res.map(r => {
  const d = Buffer.from(r.account.data[0], 'base64');
  const got = d.length;
  return {
    pd: r.pubkey,
    bytes_returned: got,
    tag: got >= 4 ? d.readUInt32LE(0) : null,
    slot: got >= 12 ? Number(d.readBigUInt64LE(4)) : null,
    opt: got >= 13 ? d[12] : null,
    elf45: got >= 49 ? d.readUInt32BE(45) === 0x7f454c46 : null,
    first_byte_after_opt: got >= 14 ? d[13] : null,
  };
});
const full = rows.filter(r => r.bytes_returned >= 49);
const short = rows.filter(r => r.bytes_returned < 49);

const optDist = full.reduce((a, r) => { a[r.opt] = (a[r.opt] || 0) + 1; return a; }, {});
const badTag = full.filter(r => r.tag !== 3);
const badElf = full.filter(r => r.elf45 !== true);
const badOpt = full.filter(r => r.opt !== 0 && r.opt !== 1);
const badSlot = full.filter(r => !(r.slot > 0 && r.slot < head));
const slotSorted = full.map(r => r.slot).sort((a, b) => a - b);
const pct = q => slotSorted[Math.floor(q * (slotSorted.length - 1))];

const report = {
  measured_at_head: head, population_n: rows.length, fully_sliced: full.length, short_slices: short.length,
  opt_tag_distribution: optDist,
  C1_opt_tag_is_0_or_1: { pass: badOpt.length === 0, violations: badOpt.length, examples: badOpt.slice(0, 5).map(r => r.pd) },
  C2_elf_magic_at_45: { pass: badElf.length === 0, violations: badElf.length, examples: badElf.slice(0, 5).map(r => ({ pd: r.pd, opt: r.opt, slot: r.slot })) },
  C3_slot_lt_head: { pass: badSlot.length === 0, violations: badSlot.length, examples: badSlot.slice(0, 5).map(r => ({ pd: r.pd, slot: r.slot })) },
  tag_not_3: badTag.length,
  slot_percentiles: { p01: pct(0.01), p10: pct(0.10), p50: pct(0.50), p90: pct(0.90), max: slotSorted[slotSorted.length - 1] },
  slot_min: slotSorted[0], slot_max: slotSorted[slotSorted.length - 1], head,
};
writeFileSync('/tmp/demand1234/popfresh-154x.json', JSON.stringify(report, null, 1));
writeFileSync('/tmp/demand1234/popfresh-rows-154x.json', JSON.stringify(full.map(r => [r.pd, r.opt, r.slot, r.elf45]), null));
console.log(JSON.stringify(report, null, 1));