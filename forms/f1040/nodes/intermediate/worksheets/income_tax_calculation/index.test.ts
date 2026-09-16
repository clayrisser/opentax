import { assertEquals, assertAlmostEquals } from "@std/assert";
import { assertThrows } from "@std/assert";
import { income_tax_calculation, inputSchema } from "./index.ts";
import { f1040 } from "../../../outputs/f1040/index.ts";
import { form6251 } from "../../forms/form6251/index.ts";
import { form_1116 } from "../../forms/form_1116/index.ts";
import { fieldsOf } from "../../../../../../core/test-utils/output.ts";
import { FilingStatus } from "../../../types.ts";

function compute(input: Record<string, unknown>) {
  return income_tax_calculation.compute({ taxYear: 2025, formType: "f1040" }, inputSchema.parse(input));
}

function f1040Fields(result: ReturnType<typeof compute>) {
  return fieldsOf(result.outputs, f1040);
}

function f6251Fields(result: ReturnType<typeof compute>) {
  return fieldsOf(result.outputs, form6251);
}

// ─── Smoke Tests ─────────────────────────────────────────────────────────────

Deno.test("smoke — missing required fields throws", () => {
  assertThrows(() => inputSchema.parse({}));
});

Deno.test("smoke — zero taxable income returns the two zero-liability outputs", () => {
  const result = compute({ taxable_income: 0, filing_status: FilingStatus.Single });
  // Even at zero income, notify f8812 for ACTC and form_1116 for the §904 limit
  assertEquals(result.outputs.length, 2);
});

// ─── Bracket Computation ─────────────────────────────────────────────────────

Deno.test("Single — $50,000 taxable income (Tax Table)", () => {
  // Under $100,000, so the Tax Table. Band 50,000–50,050, midpoint $50,025:
  // $5,578.50 + ($50,025 − $48,475) × 22% = $5,919.50, rounded to $5,920.
  const result = compute({ taxable_income: 50_000, filing_status: FilingStatus.Single });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 5_920);
});

Deno.test("MFJ — $100,000 taxable income (Tax Computation Worksheet floor)", () => {
  // $100,000 is exactly where the Tax Table stops and the worksheet starts.
  // Section B, 22% row: 0.22 × $100,000 − $10,172 = $11,828.
  const result = compute({ taxable_income: 100_000, filing_status: FilingStatus.MFJ });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 11_828);
});

Deno.test("MFS — $50,000 taxable income (Tax Table)", () => {
  // Single and MFS brackets coincide below $100,000, so the two Tax Table columns
  // carry the same figure: $5,920.
  const result = compute({ taxable_income: 50_000, filing_status: FilingStatus.MFS });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 5_920);
});

Deno.test("HOH — $70,000 taxable income (Tax Table)", () => {
  // Band 70,000–70,050, midpoint $70,025:
  // $7,442 + ($70,025 − $64,850) × 22% = $8,580.50, rounded to $8,581.
  const result = compute({ taxable_income: 70_000, filing_status: FilingStatus.HOH });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 8_581);
});

Deno.test("QSS — $100,000 uses MFJ brackets", () => {
  // QSS reads the MFJ column → same as MFJ at $100,000 = $11,828
  const result = compute({ taxable_income: 100_000, filing_status: FilingStatus.QSS });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 11_828);
});

// ─── Bracket Boundaries ───────────────────────────────────────────────────────

Deno.test("Single — at 10% ceiling ($11,925) → 10% only", () => {
  // Band 11,900–11,950, midpoint $11,925, which lands exactly on the bracket edge:
  // $11,925 × 10% = $1,192.50, rounded half up to $1,193.
  const result = compute({ taxable_income: 11_925, filing_status: FilingStatus.Single });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 1_193);
});

Deno.test("Single — $1 into 12% bracket ($11,926) reads the same band", () => {
  // $11,926 sits in the same 11,900–11,950 band as $11,925, so the table gives the
  // same $1,193. A dollar of taxable income does not move the tax; that is what a
  // banded table means.
  const result = compute({ taxable_income: 11_926, filing_status: FilingStatus.Single });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 1_193);
});

// ─── High Income ──────────────────────────────────────────────────────────────

Deno.test("Single — $700,000 (37% bracket)", () => {
  // Tax = $188,769.75 + ($700,000 − $626,350) × 37%
  // = $188,769.75 + $27,250.50 = $216,020.25
  // Over $100,000 → Tax Computation Worksheet, Section A 37% row. $216,020.25 → $216,020.
  const result = compute({ taxable_income: 700_000, filing_status: FilingStatus.Single });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 216_020);
});

Deno.test("MFS — $400,000 (37% bracket, MFS-specific split at $375,800)", () => {
  // Tax = $101,077.25 + ($400,000 − $375,800) × 37%
  // = $101,077.25 + $8,954 = $110,031.25
  // Tax Computation Worksheet, Section C 37% row. $110,031.25 → $110,031.
  const result = compute({ taxable_income: 400_000, filing_status: FilingStatus.MFS });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 110_031);
});

Deno.test("HOH — $650,000 (37% bracket)", () => {
  // Tax = $187,031.50 + ($650,000 − $626,350) × 37%
  // = $187,031.50 + $8,750.50 = $195,782.00
  // Tax Computation Worksheet, Section D 37% row.
  const result = compute({ taxable_income: 650_000, filing_status: FilingStatus.HOH });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 195_782);
});

// ─── Output Routing ───────────────────────────────────────────────────────────

Deno.test("routes line16_income_tax to f1040", () => {
  // $50k Single → $5,920 (same as the Tax Table test above)
  const result = compute({ taxable_income: 50_000, filing_status: FilingStatus.Single });
  const fields = f1040Fields(result);
  assertEquals(typeof fields?.line16_income_tax, "number");
  assertEquals(fields!.line16_income_tax as number, 5_920);
});

Deno.test("routes regular_tax, regular_tax_income, filing_status to form6251", () => {
  const result = compute({ taxable_income: 50_000, filing_status: FilingStatus.Single });
  const fields = f6251Fields(result)!;
  assertEquals(fields.regular_tax as number, 5_920);
  assertEquals(fields.regular_tax_income, 50_000);
  assertEquals(fields.filing_status, FilingStatus.Single);
});

Deno.test("tax amounts agree between f1040 and form6251 outputs", () => {
  const result = compute({ taxable_income: 100_000, filing_status: FilingStatus.MFJ });
  assertEquals(f1040Fields(result)?.line16_income_tax, f6251Fields(result)?.regular_tax);
});

// ─── Small Income ─────────────────────────────────────────────────────────────

Deno.test("$1 taxable income — first Tax Table band is zero", () => {
  // Band 0–5, midpoint $2.50, tax $0.25, which rounds to $0. The printed table's first
  // row reads "$0 / $5 / 0" in every column.
  const result = compute({ taxable_income: 1, filing_status: FilingStatus.Single });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 0);
});

// ─── Unknown Tax Year ─────────────────────────────────────────────────────────

Deno.test("unknown tax year throws with year in message", () => {
  assertThrows(
    () => income_tax_calculation.compute({ taxYear: 9999, formType: "f1040" }, inputSchema.parse({ taxable_income: 50_000, filing_status: FilingStatus.Single })),
    Error,
    "No f1040 config for year 9999",
  );
});

// ─── QDCGT Worksheet — preferential rates ────────────────────────────────────
// Rev. Proc. 2024-40, §3.02; IRC §1(h)

Deno.test("QDCGT: qualified dividends entirely in 0% bracket (Single, low income)", () => {
  // AGI below zero_ceiling ($48,350): all qual divs taxed at 0%
  // taxable_income = $40,000, qual_div = $5,000
  // ordinary = $35,000; in_zero = min($40k, $48,350) - $35k = $5k; pref_tax = 0
  // line 22 = tax on ordinary $35,000 from the Tax Table: band 35,000–35,050, midpoint
  // $35,025 → $1,192.50 + ($35,025 − $11,925) × 12% = $3,964.50 → $3,965
  // line 24 = tax on all $40,000 = $4,565, so line 25 takes the smaller, $3,965.
  const result = compute({ taxable_income: 40_000, filing_status: FilingStatus.Single, qualified_dividends: 5_000 });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 3_965);
});

Deno.test("QDCGT: qualified dividends in 15% bracket (Single, mid income)", () => {
  // taxable_income = $100,000, qual_div = $10,000
  // ordinary = $90,000; in_zero = max(0, $48,350 - $90,000) = 0; all $10k in 15%
  // line 18 = $10,000 × 15% = $1,500
  // line 22 = tax on ordinary $90,000 from the Tax Table: band 90,000–90,050, midpoint
  // $90,025 → $5,578.50 + ($90,025 − $48,475) × 22% = $14,719.50 → $14,720
  // line 23 = $16,220; line 24 = $16,914 from the worksheet, so line 25 is $16,220.
  // Note the two lookups disagree on method: ordinary income is under $100,000 and reads
  // the table, taxable income is at $100,000 and reads the worksheet.
  const result = compute({ taxable_income: 100_000, filing_status: FilingStatus.Single, qualified_dividends: 10_000 });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 16_220);
});

Deno.test("QDCGT: LTCG split across 15% and 20% brackets (Single, high income)", () => {
  // taxable_income = $600,000, net_capital_gain = $100,000
  // ordinary = $500,000; in_zero = 0
  // avail_fifteen = $533,400 - max($500,000, $48,350) = $33,400
  // in_fifteen = $33,400; in_twenty = $66,600
  // pref_tax = $33,400 × 0.15 + $66,600 × 0.20 = $5,010 + $13,320 = $18,330
  // ordinary_tax = $57,231 + ($500,000 - $250,525) × 35% = $144,547.25 → $144,547
  // total = $162,877
  const result = compute({ taxable_income: 600_000, filing_status: FilingStatus.Single, net_capital_gain: 100_000 });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 162_877);
});

Deno.test("QDCGT: MFJ qualified dividends in 0% bracket", () => {
  // MFJ zero_ceiling = $96,700; taxable_income = $80,000, qual_div = $5,000
  // ordinary = $75,000; in_zero = min($80k, $96,700) - $75k = $5k; all in 0%
  // pref_tax = 0
  // ordinary_tax = $11,157 + ($75,000 - $96,950) × ... wait, $75k < $96,950 → 22% bracket
  // line 22 = tax on ordinary $75,000 from the Tax Table: band 75,000–75,050, midpoint
  // $75,025 → $2,385 + ($75,025 − $23,850) × 12% = $8,526
  const result = compute({ taxable_income: 80_000, filing_status: FilingStatus.MFJ, qualified_dividends: 5_000 });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 8_526);
});

Deno.test("QDCGT: no qual div or LTCG — falls back to regular brackets", () => {
  // Same as the Tax Table test above
  const result = compute({ taxable_income: 50_000, filing_status: FilingStatus.Single });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 5_920);
});

Deno.test("QDCGT: zero qualified dividends — no QDCGT applied", () => {
  const result = compute({ taxable_income: 50_000, filing_status: FilingStatus.Single, qualified_dividends: 0 });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 5_920);
});

Deno.test("QDCGT: QDCGT tax is always ≤ regular bracket tax (invariant)", () => {
  // For any combination of qual div + LTCG, the QDCGT worksheet should never
  // produce MORE tax than the regular brackets.
  const cases = [
    { ti: 50_000, qd: 5_000, cg: 0 },
    { ti: 100_000, qd: 10_000, cg: 5_000 },
    { ti: 200_000, qd: 20_000, cg: 30_000 },
    { ti: 600_000, qd: 0, cg: 100_000 },
  ];
  for (const { ti, qd, cg } of cases) {
    const withQdcgt = compute({ taxable_income: ti, filing_status: FilingStatus.Single, qualified_dividends: qd, net_capital_gain: cg });
    const withoutQdcgt = compute({ taxable_income: ti, filing_status: FilingStatus.Single });
    const qdcgtTax = f1040Fields(withQdcgt)!.line16_income_tax as number;
    const regularTax = f1040Fields(withoutQdcgt)!.line16_income_tax as number;
    assertEquals(qdcgtTax <= regularTax + 0.01, true, `QDCGT ($${qdcgtTax}) exceeds regular ($${regularTax}) for ti=${ti} qd=${qd} cg=${cg}`);
  }
});

Deno.test("QDCGT: form6251 always receives regular_tax (not QDCGT reduced tax)", () => {
  // AMT uses the regular bracket tax, not the QDCGT reduced amount
  const result = compute({ taxable_income: 100_000, filing_status: FilingStatus.Single, qualified_dividends: 10_000 });
  const f1040Tax = f1040Fields(result)!.line16_income_tax as number;
  const f6251Tax = f6251Fields(result)!.regular_tax as number;
  // f1040 has QDCGT-reduced tax; f6251 has regular bracket tax
  assertEquals(f6251Tax, 16_914);     // worksheet tax on all $100k Single
  assertEquals(f1040Tax, 16_220);     // QDCGT-reduced (qual divs at 15%)
  assertEquals(f6251Tax > f1040Tax, true);
});

Deno.test("QDCGT: qualified dividends exceeding taxable income capped at taxable income", () => {
  // If somehow qual_div > taxable_income, pref_income is capped
  const result = compute({ taxable_income: 5_000, filing_status: FilingStatus.Single, qualified_dividends: 10_000 });
  // pref_income = min(10_000, 5_000) = 5_000; ordinary = 0; all in 0%
  // ordinary_tax = 0; pref_tax = 0
  assertAlmostEquals(f1040Fields(result)?.line16_income_tax as number, 0, 1);
});

Deno.test("QDCGT: HOH filing status uses HOH thresholds", () => {
  // HOH zero_ceiling = $64,750; taxable_income = $60,000, qual_div = $3,000
  // ordinary = $57,000; in_zero = min($60k, $64,750) - $57k = $3k; all in 0%
  // pref_tax = 0
  // line 22 = tax on ordinary $57,000 from the HOH Tax Table column: band 57,000–57,050,
  // midpoint $57,025 → $1,700 + ($57,025 − $17,000) × 12% = $6,503
  const result = compute({ taxable_income: 60_000, filing_status: FilingStatus.HOH, qualified_dividends: 3_000 });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 6_503);
});

// ─── Form 1116 Part III line 20 (IRC §904(a)) ────────────────────────────────
// "Individuals: Enter the total of Form 1040, 1040-SR, or 1040-NR, line 16, and
// Schedule 2 (Form 1040), line 1z." Line 16 is figured here, so the FTC
// limitation base is routed from here.

Deno.test("form_1116: line 16 routes as us_tax_before_credits", () => {
  // taxable $85,250 single, Tax Table band 85,250–85,300, midpoint $85,275:
  // $5,578.50 + ($85,275 − $48,475) × 22% = $13,674.50 → $13,675
  const result = compute({ taxable_income: 85_250, filing_status: FilingStatus.Single });
  assertEquals(fieldsOf(result.outputs, form_1116)?.us_tax_before_credits, 13_675);
});

Deno.test("form_1116: zero taxable income routes a zero limitation base", () => {
  // No US tax → line 21 is zero → no credit, the taxes carry over instead.
  const result = compute({ taxable_income: 0, filing_status: FilingStatus.Single });
  assertEquals(fieldsOf(result.outputs, form_1116)?.us_tax_before_credits, 0);
});

// ─── QDCGT line 13 — the 20% floor by filing status ──────────────────────────
//
// Qualified Dividends and Capital Gain Tax Worksheet line 13 (2025) prints
// "$300,000 if married filing separately" next to "$600,050 if married filing jointly".
// MFS is not half the MFJ figure: Rev. Proc. 2024-40 §3.02 rounds each status's maximum
// 15-percent rate amount on its own.

Deno.test("QDCGT: the MFS 20% floor is $300,000, not half of the MFJ $600,050", () => {
  // $310,000 taxable, all of it long-term gain. Ordinary income is zero, so the whole
  // gain stacks from the bottom: $48,350 at 0%, then the 15% band up to $300,000, then
  // the rest at 20%.
  //   0% on $48,350; 15% on $300,000 − $48,350 = $251,650 → $37,747.50 → $37,748
  //   20% on $310,000 − $300,000 = $10,000 → $2,000
  //   total $39,748
  // With the floor one dollar higher at $300,025 the split would move $25 from the 20%
  // band to the 15% band and the tax would be $1.25 lower.
  const result = compute({
    taxable_income: 310_000,
    filing_status: FilingStatus.MFS,
    net_capital_gain: 310_000,
  });
  assertEquals(f1040Fields(result)?.line16_income_tax as number, 39_748);
});
