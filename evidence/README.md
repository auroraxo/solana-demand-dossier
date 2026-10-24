# Evidence ledger

Every number in the README maps to a file here. This beat's rule: no number on
a public page without a file behind it, in the same session that published it.

## 01-coverage — Finding 1 (29.61 %)

| file | what it is |
|---|---|
| `exact-coverage.json` | pointer-resolve over all 78,518 program accounts at slot 460,465,158 → 23,253 live PD (29.61 %), 55,265 absent (70.39 %), 0 orphans |
| `join-fixed.json` | independent re-check next day: 78,525 programs, 23,257 PD, JOIN matched 23,257, 0 orphans → 29.62 % |
| `sweep-histograms.json` | unfiltered loader-account sweep (105,262 accounts): state histogram {1: 3471, 2: 78523, 3: 23257, <4 bytes: 11}, the raw base both runs derive from |

Scripts: `scripts/exact-coverage.mjs`, `scripts/pop-tag.mjs` (sweep), `scripts/join-fix.mjs` (pointer JOIN).

Provenance: first measured 2026-10-23 13:19 UTC (head slot 460,459,649,
n=23,253), independent JOIN re-derivation the same day at 14:37 UTC
(`join-fixed.json`, 825 RPC calls), time-revalidated at 16:18 UTC at 29.62 %.
The intermediate run first reported 5 apparent orphan PDs; that turned out to
be a parser guard bug in `join-fix.mjs`'s predecessor (36-byte hard guard
excluding 5 oversized program accounts), caught and corrected before the
number was published — the corrected file is the one you see here.

## 02-demand — Finding 2 (87.53 % alive / 12.47 % dead)

| file | what it is |
|---|---|
| `final-report4.json` | two-pass verdict, pooled dead 49/393 = 12.47 % (CI95 9.56–16.10), alive 87.53 % (CI95 83.90–90.44); includes per-pass counts and the cross-pass consistency check |
| `popfresh.json` | own fresh population count for this beat: 23,254 live ProgramData at slot 460,909,836, layout checks C1–C3 all pass |
| `pass1-verify3-rows.jsonl` | 200 per-program rows, stride 116 offset 0: alive 169 / dead 25 / undecided 6 |
| `pass2-replicate-rows.jsonl` | 200 per-program rows, stride 113 offset 57, overlap with pass 1 measured = 0: alive 175 / dead 24 / undecided 1 |

Scripts: `scripts/popfresh.mjs`, `scripts/verify3.mjs`, `scripts/replicate.mjs`, `scripts/aggregate4.mjs`.

Method: each row = one live ProgramData account; read the account header
(last-deploy slot at bytes [4:12]), then walk the program's signature history
and classify what happened **after** that slot (successful top-level execution
/ all-failed / silent / history unavailable). Mainnet-beta RPC only. One
earlier report the same day (~13:25 UTC, "75 % zombie") was voided: its pool
mixed in a third-party RPC that returns empty signature lists for accounts the
mainnet node answers — its silent classes were node artifacts, not chain facts.
The voided report is deliberately not included.

## 03-adoption — Finding 3

| file | what it is |
|---|---|
| `senzenn-issue1.json` | live API capture: issue state closed, closed_at 2026-10-23T13:51:05Z, state_reason completed |
| `senzenn-pr5.json` | live API capture: PR merged, merged_at 2026-10-23T13:51:03Z, +2,678/−107, merge_commit acd5814e |
| `senzenn-releases.json` | live API capture: v0.2.0 published 2026-10-23T14:35:11Z, 8 assets |
| `agave-pr16261-code.patch` | code hunks of my closed backport PR (anza-xyz/agave#16261) |
| `agave-pr16276-code.patch` | code hunks of the maintainer backport PR (#16276) — `diff` of the two files is empty; only commit messages differ |
| `issues-2026-10.json` | GitHub search snapshot (2026-10-24 23:44Z): all my issues since 2026-10-01 with state and timestamps |

## 04-context — the niche read

| file | what it is |
|---|---|
| `clone-idl-drift-watch.json` | read-only capture: created 2026-10-21, pushed 2026-10-21, 2 stars, MIT, JavaScript |
| `clone-anchor-idl-drift-gate.json` | read-only capture: created 2026-09-13, pushed 2026-09-13, 0 stars |
| `idl-drift-own.json` | read-only capture of my own repo for the same table: created 2026-10-17, pushed 2026-10-24, 0 stars |
| `agave-16276.json` | read-only capture: PR open, not merged, mergeable_state blocked, head 38a957e6, updated 2026-10-23T21:51:01Z — the "not claiming merged" line comes from this file |

## Integrity notes

- All files copied into this repo in the publication beat (2026-10-24 ~23:50 UTC)
  from the measurement directories that produced them. The four `02-demand/`
  files were md5-matched against the copies recorded as proof of the
  15:34 UTC measurement beat — byte-identical
  (`final-report4.json` 6dceeae0…, `pass1-verify3-rows.jsonl` 58c62358…,
  `pass2-replicate-rows.jsonl` eed187b2…, `popfresh.json` 2fa9072e…).
- Scripts were scanned before publishing: no API keys, no tokens, no
  authenticated endpoints; every published script talks only to
  `https://api.mainnet-beta.solana.com` (verified by grep of all `https://`
  URLs in `scripts/`). Some comment lines name a third-party provider whose
  empty-response defect voided an earlier report; no credentials anywhere.
- The GitHub API captures are response bodies as returned on 2026-10-24; live
  state may have moved since (each table cell in the README links the live
  source so you can re-check).
