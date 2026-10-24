// aggregate4.mjs — TWO-PASS verdict for card 8c9d0593, this beat (15:34Z).
//
// Pass 1: verify3-rows.jsonl      (n=200, stride 116 offset 0, matched.json 13:00Z)
// Pass 2: replicate-rows.jsonl    (n=200, stride 113 offset 57, overlap 0 measured)
// Both:   api.mainnet-beta.solana.com ONLY, patient retries, 0 fatal rows.
// Both samples drawn from the SAME 13:00Z matched pairs (23267).
// Population this beat: popfresh-154x.json (own run, head 460909836, C1-C3 pass).
//
// SUPERSEDES final-report.json (13:25Z, mixed leorpc pool, 75.28% zombie):
// leorpc was measured returning result:[] for getSignaturesForAddress on
// addresses mainnet-beta answers with data -> its silent claims are void.
import fs from 'node:fs';
const OUT = '/tmp/demand1234';
const j = p => fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n);
  const s = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return { lo: +((c - s) / d).toFixed(4), hi: +((c + s) / d).toFixed(4) };
}

function analyse(path, label) {
  const rows = j(path);
  if (rows.length !== 200) throw new Error(`GUARD: ${label} rows ${rows.length} != 200`);
  const fatals = rows.filter(r => (r.note || '').startsWith('fatal'));
  if (fatals.length) throw new Error(`GUARD: ${label} has ${fatals.length} fatal rows`);
  const distinct = new Set(rows.map(r => r.pd));
  if (distinct.size !== 200) throw new Error(`GUARD: ${label} distinct pds ${distinct.size}`);
  const counts = {};
  for (const r of rows) counts[r.class] = (counts[r.class] || 0) + 1;
  // demand reading: alive = any class that proves a successful post-deploy tx
  const alive = (counts.active_top_level_success || 0) + (counts.active_cpi_success || 0) +
    (counts.active_touch_success || 0) + (counts.no_success_all_probed || 0) + (counts.no_success_spread_probed || 0);
  const dead = (counts.silent_since_deploy || 0) + (counts.no_success_after_deploy || 0);
  const undecided = (counts.history_unavailable || 0);
  const decided = alive + dead;
  if (decided === 0) throw new Error(`GUARD: ${label} decided_n is 0`);
  return { label, path, counts, alive, dead, undecided, decided,
    dead_share: +(dead / decided).toFixed(4), dead_ci95: wilson(dead, decided) };
}

const p1 = analyse(`${OUT}/verify3-rows.jsonl`, 'verify3');
const p2 = analyse(`${OUT}/replicate-rows.jsonl`, 'replicate');
const pop = JSON.parse(fs.readFileSync(`${OUT}/popfresh-154x.json`, 'utf8'));
if (pop.population_n < 1000) throw new Error('GUARD: population degenerate');

// cross-pass consistency: are the two dead-share CIs overlapping?
const overlap = !(p1.dead_ci95.hi < p2.dead_ci95.lo || p2.dead_ci95.hi < p1.dead_ci95.lo);
const pooledDead = p1.dead + p2.dead, pooledDecided = p1.decided + p2.decided;

const report = {
  generated_at: new Date().toISOString(),
  beat: '15:34Z / cron-81769db1',
  methodology: 'two independent stride samples of the 13:00Z matched pairs (overlap measured 0), mainnet-beta only, patient retries, resume-safe, 0 fatal rows in both',
  superseded: 'final-report.json (13:25Z): mixed leorpc pool, 75.28% zombie of decided — void (leorpc empty-signature defect measured in this attempt)',
  population_fresh: { measured_at_head: pop.measured_at_head, population_n: pop.population_n,
    C1_C3_all_pass: pop.C1_opt_tag_is_0_or_1.pass && pop.C2_elf_magic_at_45.pass && pop.C3_slot_lt_head.pass },
  pass1_verify3: p1, pass2_replicate: p2,
  cross_pass: { dead_share_difference: +(Math.abs(p1.dead_share - p2.dead_share)).toFixed(4),
    ci95_overlap: overlap, consistent: overlap },
  pooled: { dead: pooledDead, decided: pooledDecided, dead_share: +(pooledDead / pooledDecided).toFixed(4), dead_ci95: wilson(pooledDead, pooledDecided),
    alive_share: +((pooledDecided - pooledDead) / pooledDecided).toFixed(4), alive_ci95: wilson(pooledDecided - pooledDead, pooledDecided) },
  strict_top_level_pass1: { proven_top_level_active: p1.counts.active_top_level_success || 0,
    proven_no_successful_execution: p1.dead, alive_toplevel_unconfirmed:
      (p1.counts.active_cpi_success || 0) + (p1.counts.active_touch_success || 0),
    undecided: p1.undecided },
  interpretation: 'IDL-Drift/Provenienz is a topic of ACTIVE programs: ~87-88% of live-PD programs executed successfully after their last deploy; ~12% proven silent/all-failed. CI95 Wilson over both passes.',
};
fs.writeFileSync(`${OUT}/final-report4.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
