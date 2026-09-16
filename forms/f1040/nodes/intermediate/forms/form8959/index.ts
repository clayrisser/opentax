import { z } from "zod";
import type {
  NodeOutput,
  NodeResult,
} from "../../../../../../core/types/tax-node.ts";
import { TaxNode, output } from "../../../../../../core/types/tax-node.ts";
import { OutputNodes } from "../../../../../../core/types/output-nodes.ts";
import { schedule2 } from "../../aggregation/schedule2/index.ts";
import { f1040 } from "../../../outputs/f1040/index.ts";
import { FilingStatus } from "../../../types.ts";
import type { NodeContext } from "../../../../../../core/types/node-context.ts";
import { CONFIG_BY_YEAR, type F1040Config } from "../../../config/index.ts";

// ─── TY2025 Constants ──────────────────────────────────────────────────────────
// IRC §3101(b)(2); Form 8959 line 7 — Additional Medicare Tax rate
const AMT_RATE = 0.009;

// The wage figure at which an employer starts withholding Additional Medicare Tax, and
// the figure the first two "Who Must File" bullets are measured against. Instructions
// for Form 8959 (2025): "Your employer must withhold Additional Medicare Tax on wages it
// pays to you in excess of $200,000 for the calendar year, regardless of your filing
// status and regardless of wages or compensation paid by another employer." IRC
// §3102(f)(1). It is a fixed statutory figure and is not the filing-status threshold —
// an MFS filer's threshold is $125,000 but their employer still starts at $200,000.
const EMPLOYER_WITHHOLDING_THRESHOLD = 200_000;

// ─── Schema ───────────────────────────────────────────────────────────────────

export const inputSchema = z.object({
  // Filing status — determines threshold (from general node)
  filing_status: z.nativeEnum(FilingStatus),

  // Part I: Medicare Wages & Tips
  // Line 1 — "Medicare wages and tips from Form W-2, box 5. If you have more than one
  // Form W-2, enter the total of the amounts from box 5."
  // Line 1 is the base for Part I, for the Part II threshold reduction (line 10 reads
  // line 4, which is line 1 plus tips and Form 8919 wages) and for the Part V regular
  // Medicare subtraction (line 20 reads line 1). All three are box 5, never box 1.
  // IRC §3101(b); Form 8959 (2025) lines 1, 10 and 20
  medicare_wages: z.number().nonnegative().optional(),

  // Box 5 of the single largest Form W-2, which is what the first "Who Must File"
  // bullet is measured against — "your Medicare wages and tips on any single Form W-2
  // (box 5) are greater than $200,000". It is not a line on the form; it is the only
  // way to tell an MFJ couple at $210,000 + $30,000, who must file because one employer
  // withheld Additional Medicare Tax, from one at $120,000 + $120,000, who need not.
  // An array arrives when more than one node deposits it (a W-2 plus a Form 4852).
  highest_single_medicare_wages: z.union([z.number(), z.array(z.number())]).optional(),

  // Line 2 — Unreported tips from Form 4137 line 6
  // Form 8959 line 2
  unreported_tips: z.number().nonnegative().optional(),

  // Line 3 — Wages from Form 8919 line 6
  // Form 8959 line 3
  wages_8919: z.number().nonnegative().optional(),

  // Part II: Self-Employment Income
  // Line 8 — SE income from Schedule SE Part I line 6 (negative values allowed; treated as 0)
  // Form 8959 line 8
  se_income: z.number().optional(),

  // Part III: RRTA Compensation
  // Line 14 — Total RRTA compensation and tips (W-2 box 14)
  // Form 8959 line 14
  rrta_wages: z.number().nonnegative().optional(),

  // Part V: Withholding Reconciliation
  // Line 19 — Total Medicare tax withheld (W-2 box 6 sum, includes box 12 codes B + N)
  // Includes both regular (1.45%) and additional (0.9%) Medicare; regular portion
  // is subtracted in Part V (line 20) to isolate Additional Medicare Tax withheld.
  // Form 8959 line 19
  medicare_withheld: z.number().nonnegative().optional(),

  // Line 22 — Additional Medicare Tax withheld on RRTA compensation (W-2 box 14)
  // This is already the additional-only portion as reported on W-2 box 14.
  // Form 8959 line 22
  rrta_medicare_withheld: z.number().nonnegative().optional(),
});

type Form8959Input = z.infer<typeof inputSchema>;

// ─── Pure helpers ──────────────────────────────────────────────────────────────

// Threshold for filing status
// Form 8959 line 5 / line 15; not indexed for inflation
// QSS uses MFJ threshold per IRC §3101(b)(2) and Form 8959 instructions
function threshold(status: FilingStatus, cfg: F1040Config): number {
  if (status === FilingStatus.MFJ) return cfg.additionalMedicareThresholdMfj;
  if (status === FilingStatus.QSS) return cfg.additionalMedicareThresholdMfj;
  if (status === FilingStatus.MFS) return cfg.additionalMedicareThresholdMfs;
  return cfg.additionalMedicareThresholdOther;
}

// Largest of a field that one or more upstream nodes may have deposited.
function largest(value: number | readonly number[] | undefined): number {
  if (value === undefined) return 0;
  if (Array.isArray(value)) return value.reduce((m, x) => Math.max(m, x), 0);
  return value as number;
}

// Whether Form 8959 is filed at all.
//
// Instructions for Form 8959 (2025), "Who Must File" — "You must file Form 8959 if one
// or more of the following applies to you.
//   • Your Medicare wages and tips on any single Form W-2 (box 5) are greater than
//     $200,000.
//   • Your RRTA compensation on any single Form W-2 (box 14) is greater than $200,000.
//   • Your total Medicare wages and tips plus your self-employment income, if any, and
//     your spouse's Medicare wages and tips and self-employment income, if married
//     filing jointly, are greater than the threshold amount for your filing status ...
//   • Your total RRTA compensation and tips (Form W-2, box 14) and your spouse's RRTA
//     compensation and tips, if married filing jointly, are greater than the threshold
//     amount for your filing status ..."
//
// Meeting none of them means no Form 8959, and therefore nothing on Schedule 2 line 11
// and nothing on Form 1040 line 25c: the line 24 instruction is "include this amount on
// line 25c combined with your federal income tax withholding. Attach your completed
// Form 8959 to Form 1040".
//
// This gate is what keeps Part V honest. Line 22 is line 19 minus 1.45% of line 20, so
// on a return with no Additional Medicare Tax anywhere it hands back whatever the
// employer's own rounding left in box 6 — half a dollar on a $65,000 wage — as if it
// were Additional Medicare Tax withholding. Over-withheld *ordinary* Medicare tax is
// not creditable on Form 1040: §6413(c) gives a special refund for over-withheld social
// security tax and has no Medicare counterpart, so the remedy is the employer or
// Form 843.
function mustFileForm8959(input: Form8959Input, line4: number, limit: number): boolean {
  // rrta_wages is a total with no per-form breakdown anywhere in the graph, so the
  // second bullet is measured against that total. It can only ever be generous.
  const rrta = input.rrta_wages ?? 0;
  return largest(input.highest_single_medicare_wages) > EMPLOYER_WITHHOLDING_THRESHOLD ||
    rrta > EMPLOYER_WITHHOLDING_THRESHOLD ||
    line4 + Math.max(0, input.se_income ?? 0) > limit ||
    rrta > limit ||
    // Box 14 reports Additional Medicare Tax on its own, already net of the ordinary
    // rate, and a railroad employer withholds it only above $200,000 (IRC §3202(a)). So
    // an amount there is itself evidence of the filing requirement, in a way that box 6
    // — which carries both rates in one figure — never is.
    (input.rrta_medicare_withheld ?? 0) > 0;
}

// Part I, Line 4: add lines 1 through 3
// Form 8959 line 4
function totalMedicareWages(input: Form8959Input): number {
  return (input.medicare_wages ?? 0) +
    (input.unreported_tips ?? 0) +
    (input.wages_8919 ?? 0);
}

// Part I, Line 6: excess Medicare wages above threshold
// Form 8959 line 6
function medicareWageExcess(line4: number, limit: number): number {
  return Math.max(0, line4 - limit);
}

// Part I, Line 7: Additional Medicare Tax on wages
// Form 8959 line 7
function partITax(line6: number): number {
  return line6 * AMT_RATE;
}

// Part II, Line 10: reduced SE income threshold
// Threshold is reduced (but not below zero) by total Medicare wages (line 4)
// Form 8959 line 10
function reducedSeThreshold(limit: number, line4: number): number {
  return Math.max(0, limit - line4);
}

// Part II, Line 11: excess SE income above reduced threshold
// SE income losses don't count — negative SE is treated as zero
// Form 8959 line 11-12
function seIncomeExcess(seIncome: number, line10: number): number {
  const positiveSeIncome = Math.max(0, seIncome);
  return Math.max(0, positiveSeIncome - line10);
}

// Part II, Line 13: Additional Medicare Tax on SE income
// Form 8959 line 13
function partIITax(seExcess: number): number {
  return seExcess * AMT_RATE;
}

// Part III, Line 16: excess RRTA compensation above threshold
// RRTA threshold is NOT reduced by wages (separate pool per instructions)
// Form 8959 line 16
function rrtaExcess(rrtaWages: number, limit: number): number {
  return Math.max(0, rrtaWages - limit);
}

// Part III, Line 17: Additional Medicare Tax on RRTA compensation
// Form 8959 line 17
function partIIITax(line16: number): number {
  return line16 * AMT_RATE;
}

// Round to cents to avoid IEEE-754 floating point drift
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Part IV, Line 18: total Additional Medicare Tax
// Form 8959 line 18 → Schedule 2 line 11
function totalAmtTax(p1: number, p2: number, p3: number): number {
  return toCents(p1 + p2 + p3);
}

// Part V, Line 21: regular Medicare tax withholding on Medicare wages = line20 × 1.45%
// Form 8959 line 21
function regularMedicareOnWages(line20: number): number {
  return toCents(line20 * 0.0145);
}

// Part V, Line 22: Additional Medicare Tax withheld from W-2 wages
// = max(0, line19 − line21); isolates the 0.9% additional portion
// Form 8959 line 22
function additionalMedicareFromWages(medicareWithheld: number, line20: number): number {
  return Math.max(0, medicareWithheld - regularMedicareOnWages(line20));
}

// Part V, Line 24: total Additional Medicare Tax withheld
// = line22 (wages additional) + line23 (RRTA additional)
// Form 8959 line 24 → Form 1040 line 25c
function totalAdditionalWithheld(input: Form8959Input): number {
  // Line 20 is "Enter the amount from line 1" — box 5 wages alone, not line 4. Tips from
  // Form 4137 and Form 8919 wages had no Medicare withheld by an employer, so including
  // them here would subtract withholding that never happened.
  const line20 = input.medicare_wages ?? 0;
  const line22 = additionalMedicareFromWages(input.medicare_withheld ?? 0, line20);
  const line23 = input.rrta_medicare_withheld ?? 0;
  return toCents(line22 + line23);
}

// Route total AMT to schedule2 line 11 when > 0
function schedule2Output(amtTotal: number): NodeOutput[] {
  if (amtTotal <= 0) return [];
  return [output(schedule2, { line11_additional_medicare: amtTotal })];
}

// Route total withholding to f1040 line 25c when > 0
function f1040Output(withheld: number): NodeOutput[] {
  if (withheld <= 0) return [];
  return [output(f1040, { line25c_additional_medicare_withheld: withheld })];
}

// ─── Node class ───────────────────────────────────────────────────────────────

class Form8959Node extends TaxNode<typeof inputSchema> {
  readonly nodeType = "form8959";
  readonly inputSchema = inputSchema;
  readonly outputNodes = new OutputNodes([schedule2, f1040]);

  compute(ctx: NodeContext, rawInput: Form8959Input): NodeResult {
    const cfg = CONFIG_BY_YEAR[ctx.taxYear];
    if (!cfg) throw new Error(`No f1040 config for year ${ctx.taxYear}`);
    const input = inputSchema.parse(rawInput);

    const limit = threshold(input.filing_status, cfg);

    // Part I
    const line4 = totalMedicareWages(input);

    if (!mustFileForm8959(input, line4, limit)) return { outputs: [] };

    const line6 = medicareWageExcess(line4, limit);
    const line7 = partITax(line6);

    // Part II
    const line10 = reducedSeThreshold(limit, line4);
    const seExcess = seIncomeExcess(input.se_income ?? 0, line10);
    const line13 = partIITax(seExcess);

    // Part III
    const line16 = rrtaExcess(input.rrta_wages ?? 0, limit);
    const line17 = partIIITax(line16);

    // Part IV
    const line18 = totalAmtTax(line7, line13, line17);

    // Part V
    const line24 = totalAdditionalWithheld(input);

    const outputs: NodeOutput[] = [
      ...schedule2Output(line18),
      // Route excess Medicare withholding to 1040 line25c whenever present.
      // Employers may withhold the additional 0.9% Medicare rate before wages hit
      // the $200k threshold; that excess is always creditable (IRC §31; Form 8959 Part V).
      ...f1040Output(line24),
    ];

    return { outputs };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const form8959 = new Form8959Node();
