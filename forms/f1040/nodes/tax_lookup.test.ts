import { assertEquals } from "@std/assert";
import { figureTax, TAX_TABLE_CEILING, taxFromBrackets, taxFromTable } from "./tax_lookup.ts";
import {
  BRACKETS_HOH_2025,
  BRACKETS_MFJ_2025,
  BRACKETS_MFS_2025,
  BRACKETS_SINGLE_2025,
} from "./config/2025.ts";

const columns = [
  BRACKETS_SINGLE_2025,
  BRACKETS_MFJ_2025,
  BRACKETS_MFS_2025,
  BRACKETS_HOH_2025,
];

// ─── Rows copied out of the printed table ─────────────────────────────────────
//
// Publication 1040 (2025), "2025 Tax Table", Cat. No. 46895T. Each row is
// [at least, but less than, Single, Married filing jointly, Married filing separately,
// Head of a household], exactly as printed.
//
// 25,300–25,350 is the IRS's own worked example: "A married couple is filing a joint
// return. Their taxable income on Form 1040, line 15, is $25,300 ... The amount shown
// where the taxable income line and filing status column meet is $2,562."
const PUBLISHED_ROWS: ReadonlyArray<readonly number[]> = [
  [25, 50, 4, 4, 4, 4],
  [2_975, 3_000, 299, 299, 299, 299], // last $25-wide band
  [3_000, 3_050, 303, 303, 303, 303], // first $50-wide band
  [4_250, 4_300, 428, 428, 428, 428],
  [11_900, 11_950, 1_193, 1_193, 1_193, 1_193], // Single's 10%/12% edge sits inside
  [25_200, 25_250, 2_789, 2_550, 2_789, 2_687],
  [25_250, 25_300, 2_795, 2_556, 2_795, 2_693],
  [25_300, 25_350, 2_801, 2_562, 2_801, 2_699], // the Sample Table row
  [25_350, 25_400, 2_807, 2_568, 2_807, 2_705],
  [35_000, 35_050, 3_965, 3_726, 3_965, 3_863],
  [48_450, 48_500, 5_579, 5_340, 5_579, 5_477], // Single's 12%/22% edge sits inside
  [50_000, 50_050, 5_920, 5_526, 5_920, 5_663],
  [57_000, 57_050, 7_460, 6_366, 7_460, 6_503],
  [64_850, 64_900, 9_187, 7_308, 9_187, 7_448], // HOH's 12%/22% edge sits inside
  [90_000, 90_050, 14_720, 10_326, 14_720, 12_981],
  [96_950, 97_000, 16_249, 11_163, 16_249, 14_510], // MFJ's 12%/22% edge sits inside
  [99_950, 100_000, 16_909, 11_823, 16_909, 15_170], // last band in the table
];

Deno.test("Tax Table — the generated figure matches every published row, at both ends of the band", () => {
  for (const [lo, hi, ...expected] of PUBLISHED_ROWS) {
    for (let c = 0; c < columns.length; c++) {
      assertEquals(
        taxFromTable(lo, columns[c]),
        expected[c],
        `band ${lo}–${hi}, column ${c}, looked up at the bottom of the band`,
      );
      assertEquals(
        taxFromTable(hi - 1, columns[c]),
        expected[c],
        `band ${lo}–${hi}, column ${c}, looked up at the top of the band`,
      );
    }
  }
});

Deno.test("Tax Table — the first three bands are narrower than $25", () => {
  // Printed: 0–5 → 0, 5–15 → 1, 15–25 → 2, in every column.
  for (const brackets of columns) {
    assertEquals(taxFromTable(1, brackets), 0);
    assertEquals(taxFromTable(4, brackets), 0);
    assertEquals(taxFromTable(5, brackets), 1);
    assertEquals(taxFromTable(14, brackets), 1);
    assertEquals(taxFromTable(15, brackets), 2);
    assertEquals(taxFromTable(24, brackets), 2);
    assertEquals(taxFromTable(25, brackets), 4);
  }
});

Deno.test("Tax Table — Single and MFS share every figure below $100,000", () => {
  // Their brackets coincide up to $103,350, so the two printed columns are identical
  // over the whole table. Falls out of the rule; worth pinning because a transcription
  // error in either bracket array would break it.
  for (let income = 0; income < TAX_TABLE_CEILING; income += 137) {
    assertEquals(
      taxFromTable(income, BRACKETS_SINGLE_2025),
      taxFromTable(income, BRACKETS_MFS_2025),
      `income ${income}`,
    );
  }
});

Deno.test("Tax Table — tax never goes down as income goes up", () => {
  for (const brackets of columns) {
    let previous = 0;
    for (let income = 0; income < TAX_TABLE_CEILING; income += 7) {
      const tax = taxFromTable(income, brackets);
      assertEquals(tax >= previous, true, `income ${income}: ${tax} < ${previous}`);
      previous = tax;
    }
  }
});

// ─── Tax Computation Worksheet ────────────────────────────────────────────────
//
// Instructions for Form 1040 (2025), p. 80. Every row is (a) × (b) − (d). Checking the
// bracket arithmetic against the printed multiplication and subtraction amounts is what
// establishes that the two are the same line.

const WORKSHEET_ROWS: ReadonlyArray<{
  readonly section: string;
  readonly brackets: ReadonlyArray<{ over: number; upTo: number; rate: number; base: number }>;
  readonly rate: number;
  readonly subtract: number;
  readonly from: number;
  readonly to: number;
}> = [
  { section: "A Single", brackets: BRACKETS_SINGLE_2025, rate: 0.22, subtract: 5_086, from: 100_000, to: 103_350 },
  { section: "A Single", brackets: BRACKETS_SINGLE_2025, rate: 0.24, subtract: 7_153, from: 103_350, to: 197_300 },
  { section: "A Single", brackets: BRACKETS_SINGLE_2025, rate: 0.32, subtract: 22_937, from: 197_300, to: 250_525 },
  { section: "A Single", brackets: BRACKETS_SINGLE_2025, rate: 0.35, subtract: 30_452.75, from: 250_525, to: 626_350 },
  { section: "A Single", brackets: BRACKETS_SINGLE_2025, rate: 0.37, subtract: 42_979.75, from: 626_350, to: 2_000_000 },
  { section: "B MFJ", brackets: BRACKETS_MFJ_2025, rate: 0.22, subtract: 10_172, from: 100_000, to: 206_700 },
  { section: "B MFJ", brackets: BRACKETS_MFJ_2025, rate: 0.24, subtract: 14_306, from: 206_700, to: 394_600 },
  { section: "B MFJ", brackets: BRACKETS_MFJ_2025, rate: 0.32, subtract: 45_874, from: 394_600, to: 501_050 },
  { section: "B MFJ", brackets: BRACKETS_MFJ_2025, rate: 0.35, subtract: 60_905.50, from: 501_050, to: 751_600 },
  { section: "B MFJ", brackets: BRACKETS_MFJ_2025, rate: 0.37, subtract: 75_937.50, from: 751_600, to: 2_000_000 },
  { section: "C MFS", brackets: BRACKETS_MFS_2025, rate: 0.22, subtract: 5_086, from: 100_000, to: 103_350 },
  { section: "C MFS", brackets: BRACKETS_MFS_2025, rate: 0.24, subtract: 7_153, from: 103_350, to: 197_300 },
  { section: "C MFS", brackets: BRACKETS_MFS_2025, rate: 0.32, subtract: 22_937, from: 197_300, to: 250_525 },
  { section: "C MFS", brackets: BRACKETS_MFS_2025, rate: 0.35, subtract: 30_452.75, from: 250_525, to: 375_800 },
  { section: "C MFS", brackets: BRACKETS_MFS_2025, rate: 0.37, subtract: 37_968.75, from: 375_800, to: 2_000_000 },
  { section: "D HOH", brackets: BRACKETS_HOH_2025, rate: 0.22, subtract: 6_825, from: 100_000, to: 103_350 },
  { section: "D HOH", brackets: BRACKETS_HOH_2025, rate: 0.24, subtract: 8_892, from: 103_350, to: 197_300 },
  { section: "D HOH", brackets: BRACKETS_HOH_2025, rate: 0.32, subtract: 24_676, from: 197_300, to: 250_500 },
  { section: "D HOH", brackets: BRACKETS_HOH_2025, rate: 0.35, subtract: 32_191, from: 250_500, to: 626_350 },
  { section: "D HOH", brackets: BRACKETS_HOH_2025, rate: 0.37, subtract: 44_718, from: 626_350, to: 2_000_000 },
];

Deno.test("Tax Computation Worksheet — all 25 printed rows agree with the bracket table", () => {
  for (const row of WORKSHEET_ROWS) {
    for (const income of [row.from + 1, Math.floor((row.from + row.to) / 2), row.to]) {
      const printed = income * row.rate - row.subtract;
      const computed = taxFromBrackets(income, row.brackets);
      assertEquals(
        Math.round(printed * 100),
        Math.round(computed * 100),
        `Section ${row.section}, ${row.rate * 100}% row, $${income}`,
      );
    }
  }
});

// ─── Which method applies ─────────────────────────────────────────────────────

Deno.test("figureTax — $99,999 reads the table and $100,000 reads the worksheet", () => {
  // "If your taxable income is less than $100,000, you must use the Tax Table ...
  //  If your taxable income is $100,000 or more, use the Tax Computation Worksheet."
  assertEquals(figureTax(99_999, BRACKETS_MFJ_2025), 11_823); // last printed MFJ figure
  assertEquals(figureTax(100_000, BRACKETS_MFJ_2025), 11_828); // 0.22 × 100,000 − 10,172
});

Deno.test("figureTax — the amount is rounded to a whole dollar before it is looked up", () => {
  // Both the table and the worksheet look up a whole-dollar line, so cents arriving from
  // an upstream worksheet round first rather than falling into the wrong band.
  assertEquals(figureTax(49_999.60, BRACKETS_SINGLE_2025), figureTax(50_000, BRACKETS_SINGLE_2025));
  assertEquals(figureTax(99_999.40, BRACKETS_MFJ_2025), figureTax(99_999, BRACKETS_MFJ_2025));
  assertEquals(figureTax(99_999.60, BRACKETS_MFJ_2025), figureTax(100_000, BRACKETS_MFJ_2025));
});

Deno.test("figureTax — zero and negative amounts produce no tax", () => {
  assertEquals(figureTax(0, BRACKETS_SINGLE_2025), 0);
  assertEquals(figureTax(-5_000, BRACKETS_SINGLE_2025), 0);
});
