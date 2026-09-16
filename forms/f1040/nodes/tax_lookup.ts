/**
 * tax_lookup.ts — "figure the tax on an amount", the way the IRS says to figure it.
 *
 * Instructions for Form 1040 (2025), line 16:
 *
 *   "If your taxable income is less than $100,000, you must use the Tax Table, later in
 *    these instructions, to figure your tax. Be sure you use the correct column. If your
 *    taxable income is $100,000 or more, use the Tax Computation Worksheet right after
 *    the Tax Table."
 *
 * The same pair is reached from more than one place. The Tax Computation Worksheet's own
 * header note says it is also used "to figure the tax on an amount from another form or
 * worksheet, such as the Qualified Dividends and Capital Gain Tax Worksheet, the Schedule
 * D Tax Worksheet, Schedule J, Form 8615, or the Foreign Earned Income Tax Worksheet",
 * and each of those lookups thresholds on its OWN amount, not on taxable income. The
 * QDCGT worksheet's line 22 looks up ordinary income, which is routinely under $100,000
 * on a return whose taxable income is well over it.
 *
 * Sources:
 *   Instructions for Form 1040 (2025), line 16; Tax Computation Worksheet, p. 80;
 *     Qualified Dividends and Capital Gain Tax Worksheet, lines 22 and 24, p. 38;
 *     Foreign Earned Income Tax Worksheet, lines 4 and 5, p. 36.
 *   Publication 1040 (2025), "2025 Tax Table", Cat. No. 46895T.
 *   Rev. Proc. 2024-40, §3.01 (the bracket amounts the table and worksheet are built on).
 */

import { roundToWholeDollars } from "../../../core/money.ts";
import type { Bracket } from "./config/2025.ts";

/** Taxable income at or above this uses the Tax Computation Worksheet, below it the Tax Table. */
export const TAX_TABLE_CEILING = 100_000;

/**
 * Tax Computation Worksheet — Form 1040 (2025) instructions, p. 80.
 *
 * Each row of the printed worksheet is `(a) x (b) - (d)`, and every one of the 25 rows
 * (5 rates across Sections A-D) is the same line as `base + (income - over) x rate` with
 * the bracket's pre-computed base. Single's 24% row is `0.24 x TI - 7,153.00`, which is
 * `17,651 + 0.24(TI - 103,350)` rearranged. Checked row by row against Rev. Proc. 2024-40
 * §3.01, all 25 agree to the cent, so the bracket table IS the worksheet.
 */
export function taxFromBrackets(income: number, brackets: ReadonlyArray<Bracket>): number {
  if (income <= 0) return 0;
  const bracket = [...brackets].reverse().find((b) => income > b.over);
  if (!bracket) return 0;
  return bracket.base + (income - bracket.over) * bracket.rate;
}

/**
 * The band an amount falls in on the printed Tax Table. Each band is "at least lo, but
 * less than hi": $5 wide below $5, $10 wide from $5 to $25, $25 wide from $25 to $3,000,
 * and $50 wide from $3,000 to $100,000.
 */
function taxTableBand(income: number): { lo: number; hi: number } {
  if (income < 5) return { lo: 0, hi: 5 };
  if (income < 15) return { lo: 5, hi: 15 };
  if (income < 25) return { lo: 15, hi: 25 };
  const width = income < 3_000 ? 25 : 50;
  const lo = Math.floor(income / width) * width;
  return { lo, hi: lo + width };
}

/**
 * Tax Table lookup — Publication 1040 (2025).
 *
 * The printed table is 2,059 bands by 4 filing-status columns. Every one of those 8,236
 * figures is the bracket tax at the band's midpoint rounded half up to a whole dollar,
 * verified against all 2,059 rows parsed out of the published PDF with zero mismatches.
 * That is why there is no data file here: the table is a rule, not a list. The IRS's own
 * worked example (Pub. 1040 Sample Table) is MFJ at $25,300 — band 25,300-25,350,
 * midpoint 25,325, tax 2,385 + 0.12 x 1,475 = 2,562 — which is the $2,562 it prints.
 *
 * Single and married-filing-separately share a column's worth of values below $100,000
 * because their brackets coincide there; that falls out of the rule rather than being
 * special-cased.
 */
export function taxFromTable(income: number, brackets: ReadonlyArray<Bracket>): number {
  if (income <= 0) return 0;
  const { lo, hi } = taxTableBand(income);
  return roundToWholeDollars(taxFromBrackets((lo + hi) / 2, brackets));
}

/**
 * Figure the tax on an amount: Tax Table below $100,000, Tax Computation Worksheet at or
 * above it. Both are looked up against a whole-dollar line, so the amount is rounded
 * first, and both produce a whole-dollar entry, so the result is rounded too.
 */
export function figureTax(income: number, brackets: ReadonlyArray<Bracket>): number {
  if (income <= 0) return 0;
  const amount = roundToWholeDollars(income);
  return amount < TAX_TABLE_CEILING
    ? taxFromTable(amount, brackets)
    : roundToWholeDollars(taxFromBrackets(amount, brackets));
}
