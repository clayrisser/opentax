# Fork notes

`clayrisser/opentax` is a fork of `filedcom/opentax`. It carries six correctness
patches to the 2025 Form 1040 graph, each of which is also open as a pull
request upstream, plus the filing-software convention work described below.

`main` CARRIES the six patches, as of 2026-09-16. A plain clone of this fork
computes a correct TY2025 return with nothing applied by hand; upstream `main`
does not. This is a soft fork, not upstream repackaged.

Every patch also sits on its own branch off the upstream commit it was written
against, because that is the shape the upstream pull requests need. `fix/all` is
the six merged together and is what `main` took in.

## What this fork carries

| Branch | What it fixes | Upstream issue | Pull request |
| --- | --- | --- | --- |
| `fix/foreign-wages-agi` | `fec` foreign employer compensation reaches AGI, and `line1a_wages` accumulates instead of failing the f1040 Zod parse next to a W-2 | [#2](https://github.com/filedcom/opentax/issues/2) | [#13](https://github.com/filedcom/opentax/pull/13) |
| `fix/se-400-gate-netting` | Schedule C businesses are netted before the $400 Schedule SE test, so a loss in one reduces the profit of another | [#3](https://github.com/filedcom/opentax/issues/3) | [#14](https://github.com/filedcom/opentax/pull/14) |
| `fix/qbi-loss-and-se-deduction` | Form 8995 nets business losses, reduces QBI by the SE tax, SE health insurance and retirement deductions, and subtracts net capital gain from the income limit | [#4](https://github.com/filedcom/opentax/issues/4), [#5](https://github.com/filedcom/opentax/issues/5) | [#15](https://github.com/filedcom/opentax/pull/15) |
| `fix/5329-8606-and-8959-line` | Form 5329 takes its base from Form 8606 line 15c, and Form 8959 Part II takes Schedule SE line 6 rather than line 3 | [#6](https://github.com/filedcom/opentax/issues/6), [#8](https://github.com/filedcom/opentax/issues/8) | [#16](https://github.com/filedcom/opentax/pull/16) |
| `fix/469-passive-loss` | The §469 passive activity limit applies to rental losses, so a loss is no longer deducted and suspended at the same time | [#7](https://github.com/filedcom/opentax/issues/7) | [#17](https://github.com/filedcom/opentax/pull/17) |
| `fix/f1116-wage-tax-limit` | Form 1116 applies the §904 limit, and foreign tax on wages routes in as general category income | [#11](https://github.com/filedcom/opentax/issues/11) | [#18](https://github.com/filedcom/opentax/pull/18) |

Every pull request is open. When one merges upstream, drop its branch from the
`fix/all` rebuild below and the fork gets smaller.

## Agreeing with TurboTax and TaxAct to the dollar

`fix/exact-to-filing-software` makes the engine compute what the two filing
programs compute, and moves the benchmark bar to exact.

- **Every entry is a whole dollar.** `core/money.ts` rounds half up at the
  executor, on the typed entries going in and on every field a node passes
  downstream. Instructions for Form 1040 (2025), "Rounding Off to Whole Dollars",
  p. 23. The instruction's "add in cents and round only the total" refinement is
  deliberately not followed: TurboTax and TaxAct round each entry as it is typed,
  and they are the target.
- **Line 16 comes off the IRS Tax Table below $100,000.** `forms/f1040/nodes/
  tax_lookup.ts`. The table is generated from the band-midpoint rule, verified
  against all 2,059 printed bands of Publication 1040 (2025) with zero
  mismatches, so there is no data file. The Tax Computation Worksheet at or above
  $100,000 is the bracket table already, row for row. Seven call sites, because
  the QDCGT worksheet, the Foreign Earned Income Tax Worksheet and Form 8615 each
  look up their own amount and threshold on it separately.
- **Form 8959 line 1 is W-2 box 5.** Box 1 appears nowhere on the form; line 10
  and line 20 both read back to line 1.
- **The MFS 20% capital gain floor is $300,000**, per QDCGT worksheet line 13.

`deno task bench` compares with `===`. There is no tolerance and there should not
be one: the $5 it used to carry could not see the $3.50 Tax Table error it was
sitting on. If a case cannot reach zero, leave it failing and say why.

Re-deriving the 133 benchmark cases under this convention moved 693 expected
values across 122 of them. Four cases did NOT move, because they were authored
from the Tax Table and were right while the engine was wrong. 53 expected values
in those files disagree with the engine for reasons that predate this work, are
not read by the harness, and were left exactly as found rather than quietly
overwritten.

## What it does not fix

Three defects from the same review are filed upstream and unpatched here:
Schedule 2 Part II landing on Form 1040 line 17 instead of line 23
([#9](https://github.com/filedcom/opentax/issues/9)), Form 2210 never computing
a penalty and line 38 never reaching line 37
([#10](https://github.com/filedcom/opentax/issues/10)), and `form add` accepting
intermediate node types that the graph then drops, which leaves `form2555` with
no input route at all ([#12](https://github.com/filedcom/opentax/issues/12)).
That last one also blocks the §911(d)(6) half of the Form 1116 work.

One pre-existing wart survives on `fix/all`: `line1a_wages` still resolves as an
array in the printed return, because `assembleReturn` re-deposits its own total.
AGI and total tax are right and the MeF writer takes the last entry, but the PDF
builder would stringify it. `line3a` and `line16` have the same shape.

## State

`fix/all` is the upstream base plus six `--no-ff` merges. Against that base,
`deno task test` goes from 6067 to 6118 passing, which is exactly the sum of the
six branches' additions, and `deno task bench` stays at 133 PASS with 16 of the
133 rows moved by a corrected reference. Three test failures are inherited from
upstream and untouched: `eitc/index.test.ts:296`, `form8889/index.test.ts:41`
and `:53`.

On top of that, `fix/exact-to-filing-software` takes `deno task test` to 6140
passing with the same three upstream failures, and `deno task bench` to 133 PASS
at a tolerance of zero.

## Rebasing on an upstream release

The merges conflict in the same four places every time, so rebuild `fix/all`
rather than rebasing it.

```sh
git fetch upstream --tags
git checkout main
git merge --ff-only upstream/main

# each patch branch onto the new tag
for b in fix/foreign-wages-agi fix/f1116-wage-tax-limit fix/469-passive-loss \
         fix/se-400-gate-netting fix/qbi-loss-and-se-deduction \
         fix/5329-8606-and-8959-line; do
  git checkout "$b" && git rebase v2.0.2 || break
done

# rebuild the integration branch in this order
git checkout -B fix/all v2.0.2
for b in fix/foreign-wages-agi fix/f1116-wage-tax-limit fix/469-passive-loss \
         fix/se-400-gate-netting fix/qbi-loss-and-se-deduction \
         fix/5329-8606-and-8959-line; do
  git merge --no-ff "$b" || break
done

deno task test
deno task bench
```

Substitute the tag you are moving to for `v2.0.2`. Skip any branch whose pull
request has merged upstream.

The four conflicts, each resolved by keeping both fixes:

1. `fec/index.ts` (#13 against #18). Both add a second output to the same node.
   `outputNodes` ends up `[f1040, agi_aggregator, form_1116]` and `compute`
   spreads both outputs. No arithmetic from either side changes.
2. `fec/index.test.ts` (#13 against #18). Both append a section 7. Keep #13's
   *7. AGI Routing* and renumber #18's block to *8. Foreign Tax on Wages*. The
   two `outputs.length` assertions stay at #13's value of 2: with no
   `foreign_tax_paid_usd` the node emits f1040 and agi_aggregator, and no
   form_1116.
3. `agi_aggregator/index.ts` (#18 against #17). `outputNodes` lists both
   `form_1116` and `form8582`, and `compute()` pushes both conditional outputs,
   whose guards do not overlap. Note the interaction: #17 makes `grossIncome()`
   subtract the §469-allowed passive loss, and #18 reads `grossIncome()` as the
   Form 1116 line 3e denominator, so line 3e ends up net of the passive limit.
   Nothing in the suite or the benchmark moves because of it, and the ratio
   clamps to 1.0 where it could matter, but "gross income from all sources"
   arguably should be gross of that limit. Worth a look before either lands
   upstream.
4. `schedule_c/index.ts` (#14 against #15). The two rewrote the same routing in
   opposite directions. Take each side's answer for the output it is about:
   #14's single combined `schedule_se` output, gated once on the combined line
   4c test over the non-exempt businesses, and #15's aggregate `form8995` push,
   ungated and including SE-exempt businesses per i8995. #14's netting survives
   because that aggregate is already the net. Both branches' `schedule_c` tests
   pass on the result.

`schedule_se/index.ts` and its test file also conflict between #15 and #16, but
additively: the `form8959` route takes #16's `line6` and #15's
`form8995 { se_tax_deduction: line13 }` route sits alongside it.

## Licensing

Upstream is AGPL-3.0 with a commercial license available from Filed Inc., and
this fork inherits both, unchanged. `LICENSE`, `LICENSE.commercial` and `NOTICE`
are upstream's.

The AGPL §13 obligation, offering Corresponding Source to the people using the
program, only attaches when a modified engine is made available to users over a
network. Running this fork locally or inside one organisation, with no network
service offered to anyone, triggers nothing. Distributing copies, source or
binary, triggers the ordinary §5 and §6 obligations whether or not a network is
involved.

`NOTICE` reserves the right to apply for IRS MeF Software Developer or
Transmitter authorization on this codebase to Filed Inc. and its OTTA partners.
That reservation is independent of the license and applies to this fork too.

## Three upstream test failures the fork does not cause

`deno task test` on this fork reports 6118 passed, 3 failed. All three fail the
same way on upstream `ae54e23`, before any patch here, verified 2026-09-16 by
running the two files in a worktree at that commit:

- `eitc` — `MFJ_vs_single_1_child` at $45,000
- `form8889` — `total contributions capped at annual limit (self_only 4300)`
- `form8889` — `employer fills entire limit`, where `schedule1` has no outputs
  at all and the read of `line13_hsa_deduction` throws

They are upstream's, not ours, and neither EITC nor an HSA appears in the return
this fork was built for. `deno task bench` is 133 PASS, 0 FAIL, so no benchmark
case regressed.
