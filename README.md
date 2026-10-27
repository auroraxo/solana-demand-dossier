# Solana demand dossier — IDL drift & program provenance

> A citable one-page version of the three numbers below lives at
> <https://codebyaurora.com/solana-findings/> — same figures, same evidence links.

Three measured facts about the Solana mainnet, each with the raw artifact that
produced it. No claim on this page is a memory number: every figure below is
re-derivable from a file in `evidence/`, and every script that produced those
files is in `scripts/`.

**The question this answers.** *Is "your committed Anchor IDL no longer matches
what is deployed" a topic about live programs people still use — or about
archives nobody touches?* The answer decides whether anyone would ever build a
tool for it.

---

## Finding 1 — Only 29.61 % of upgradeable programs have a live ProgramData account

**29.61 %** of Solana programs on mainnet resolve to a living ProgramData
account. The other **70.39 %** point at an account that no longer exists.

| | value |
|---|---|
| program accounts (denominator) | **78,518** |
| of those, pointer resolves to a live ProgramData | **23,253 → 29.61 %** |
| pointer resolves to a non-existent ProgramData | **55,265 → 70.39 %** |
| ProgramData accounts no program points at (orphans) | **0** |
| measured at slot | 460,465,158 |

Why it matters: a tool that answers "is the IDL on chain the one in your repo?"
can only answer it **where a ProgramData account exists**. That is the 29.61 %
half. For the other 70.39 % the account was closed, and the on-chain copy of
the IDL is gone with it.

The 70.39 % are **not** dead programs. A separate measurement on 12 of them
found 0 signatures after the close and successful top-level execution right up
until minutes before it — active usage that ended on the deletion day.

**Re-check (independent JOIN, next day, different slot):** 78,525 programs,
23,257 matched, 0 orphans → **29.62 %**. Two independent runs, two slots,
same number.

Evidence: [`evidence/01-coverage/`](evidence/01-coverage/)
· Scripts: `scripts/exact-coverage.mjs`, `scripts/join-fix.mjs`, `scripts/pop-tag.mjs`

---

## Finding 2 — 87.53 % of those live programs are still in active use

Of the live ProgramData accounts, **87.53 %** had a successful transaction
after their last deploy. **12.47 %** are silent.

| | value |
|---|---|
| sample | 2 independent stride samples, n=200 each, overlap measured = 0 |
| decided programs | **393** |
| alive (successful execution after last deploy) | **344 → 87.53 %** (CI95 83.90 – 90.44) |
| dead (no successful execution after last deploy) | **49 → 12.47 %** (CI95 9.56 – 16.10) |
| population behind the sample | 23,254 live ProgramData accounts at slot 460,909,836 |

Why it matters: **IDL drift is a live-program topic, not an archive topic.**
Roughly seven in eight programs that could still be checked are programs people
still call.

Both passes are reproduced from the per-program rows with
`scripts/aggregate4.mjs` — the script refuses to print a number unless all
guards pass (row counts, distinct programs, zero fatal rows, non-degenerate
population).

Evidence: [`evidence/02-demand/`](evidence/02-demand/)

---

## Finding 3 — The gap gets found and fixed upstream, in public

This is the part that moved from "a topic" to "a topic people act on".

| repo | what happened | link |
|---|---|---|
| senzenn/idl-drift | issue → implementor wrote the check → merged → released | [issue #1](https://github.com/senzenn/idl-drift/issues/1) → [PR #5](https://github.com/senzenn/idl-drift/pull/5) (+2,678 lines, merged 2026-10-23 13:51 UTC) → [release v0.2.0](https://github.com/senzenn/idl-drift/releases/tag/v0.2.0) |
| anza-xyz/agave | my v1-transaction CLI backport → maintainer backported the same fix | [my PR #16261](https://github.com/anza-xyz/agave/pull/16261) (closed, not merged) → [their PR #16276](https://github.com/anza-xyz/agave/pull/16276) (open, `mergeable_state: blocked`, awaiting review) |

The two agave patches are **byte-identical in their code hunks** — only the
commit message differs:

```
$ md5sum evidence/03-adoption/agave-pr162*-code.patch
evidence/03-adoption/agave-pr16261-code.patch  md5 2e11e5c332fae7a534b430629975ef3b
evidence/03-adoption/agave-pr16276-code.patch  md5 2e11e5c332fae7a534b430629975ef3b
```

Both patches are in [`evidence/03-adoption/`](evidence/03-adoption/) so you can
diff them yourself:

```bash
diff evidence/03-adoption/agave-pr16261-code.patch evidence/03-adoption/agave-pr16276-code.patch && echo identical
```

**I am not claiming #16276 as merged.** It is open and awaiting maintainer
review.

Findings I reported upstream, with current state (read 2026-10-24):

| finding | repo | state |
|---|---|---|
| on-chain IDL names a program address that was never deployed | [jup-ag/rfq-webhook-toolkit#95](https://github.com/jup-ag/rfq-webhook-toolkit/issues/95) | open, 0 comments |
| committed IDL behind the deployed program | [raydium-io/raydium-idl#6](https://github.com/raydium-io/raydium-idl/issues/6) | open, 0 comments |
| no on-chain IDL account for a program | [Dual-Finance/staking-options#73](https://github.com/Dual-Finance/staking-options/issues/73) | open, 1 comment (mine) |
| committed IDL names the wrong program | [marinade-finance/marinade-ts-sdk#111](https://github.com/marinade-finance/marinade-ts-sdk/issues/111) | open, 2 comments (both mine) |
| `Anchor.toml` id differs from `declare_id!` | [openbook-dex/openbook-v2#294](https://github.com/openbook-dex/openbook-v2/issues/294) | open, 1 comment (mine) |

Full inventory incl. the exact timestamps: `evidence/03-adoption/issues-2026-10.json`

---

## Context — the niche is filling up, and my tool is not the one getting stars

Two independent projects do adjacent work. Read-only observation, no
interaction with either:

| project | created | last push | what it actually does |
|---|---|---|---|
| [Positano777/idl-drift-watch](https://github.com/Positano777/idl-drift-watch) | 2026-10-21 | 2026-10-21 | offline structural **diff of two IDL files** — file-to-file, no chain access |
| [secretofwining-lab/anchor-idl-drift-gate](https://github.com/secretofwining-lab/anchor-idl-drift-gate) | 2026-09-13 | 2026-09-13 | CI gate comparing committed IDL against **Rust source**, no chain access |
| [auroraxo/idl-drift](https://github.com/auroraxo/idl-drift) (mine) | 2026-10-17 | 2026-10-24 | GitHub Action: committed IDL vs **the on-chain IDL account** |

My honest read: neither of the two is a clone of my tool — they compare
*files* against each other (IDL↔IDL, IDL↔Rust), while the question I measured
is *committed IDL vs the IDL actually published on chain*, which needs an RPC
read and cannot be answered by diffing two files on disk. But the signal they
send is real: **two strangers wrote tools in this niche in the last six weeks**,
and one of them has stars while mine does not. The 2★ on a file-diff tool is
demand evidence for the **topic**, not for the tool.

That is the honest market read, and it is why this page exists: the numbers
above are the part that is hard to reproduce, and the numbers are worth more
than the tool.

Evidence (read-only API captures): [`evidence/04-context/`](evidence/04-context/)

---

## Reproduce it

Every script talks to `https://api.mainnet-beta.solana.com` read-only. No
signing, no writes, no paid provider, no archive node.

```bash
# Finding 1 — sweep + pointer JOIN (writes one JSON per step)
node scripts/pop-tag.mjs
node scripts/join-fix.mjs

# Finding 2 — fresh population count, then the two sample passes, then aggregate
node scripts/popfresh.mjs
node scripts/verify3.mjs
node scripts/replicate.mjs
node scripts/aggregate4.mjs   # prints only if every guard passes
```

`aggregate4.mjs` throws on: wrong row count, any fatal row, duplicate programs,
degenerate population, or a decided-set of zero. It also refuses to average
two passes whose confidence intervals do not overlap silently — it reports the
overlap explicitly.

## Honest limits

- **The 29.61 % figure is a coverage statement, not a bug count.** A missing
  ProgramData means the on-chain IDL copy is gone. It does not mean the
  program's behaviour changed, and it does not mean the program is broken.
- **The 87.53 % figure is a sample of 393 decided programs** out of 23,254
  live ones (CI95 83.90 – 90.44 on the alive share). The two passes are
  independent and disjoint, but this is a sample, not the full population.
- **"Alive" means a successful transaction after the last deploy**, observed
  within the node's signature retention window. A program used less often than
  the retention window can look dead here.
- **The upstream reactions are a small sample of maintainers.** One merged and
  released; four are still open with no reply. Both facts are in the table
  above rather than smoothed into a story.
- Node artefacts are called out explicitly in the evidence: one RPC provider
  returned empty signature lists for addresses the mainnet node answered, which
  produced a "75 % of programs are dead" number that was **void** and replaced
  by the two-pass measurement above. The voided report is not in this repo, on
  purpose.

## License

MIT. The evidence files are raw measurement output; the scripts are the ones
that produced them.
