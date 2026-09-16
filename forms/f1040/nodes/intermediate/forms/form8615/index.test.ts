import { assertEquals, assertAlmostEquals } from "@std/assert";
import { form8615 } from "./index.ts";
import { FilingStatus } from "../../../types.ts";

function compute(input: Record<string, unknown>) {
  return form8615.compute({ taxYear: 2025, formType: "f1040" }, input);
}

function findOutput(result: ReturnType<typeof compute>, nodeType: string) {
  return result.outputs.find((o) => o.nodeType === nodeType);
}

// ─── Smoke Tests ─────────────────────────────────────────────────────────────

Deno.test("smoke — empty input returns no outputs", () => {
  const result = compute({});
  assertEquals(result.outputs.length, 0);
});

Deno.test("no unearned income — no outputs", () => {
  const result = compute({
    net_unearned_income: 0,
    parent_taxable_income: 80_000,
    parent_filing_status: FilingStatus.MFJ,
    parent_tax: 9_000,
  });
  assertEquals(result.outputs.length, 0);
});

// ─── Threshold Tests ─────────────────────────────────────────────────────────

Deno.test("NUI at threshold ($2,600) — no taxable NUI, no outputs", () => {
  const result = compute({
    net_unearned_income: 2_600,
    parent_taxable_income: 80_000,
    parent_filing_status: FilingStatus.MFJ,
    parent_tax: 9_000,
  });
  assertEquals(result.outputs.length, 0);
});

Deno.test("NUI below threshold ($2,599) — no outputs", () => {
  const result = compute({
    net_unearned_income: 2_599,
    parent_taxable_income: 80_000,
    parent_filing_status: FilingStatus.MFJ,
    parent_tax: 9_000,
  });
  assertEquals(result.outputs.length, 0);
});

Deno.test("NUI just above threshold ($2,601) — kiddie tax applies", () => {
  // Taxable NUI = $2,601 - $2,600 = $1
  // Parent income $80,000 MFJ; tax on $80,001 vs $80,000 at 12% = $0.12 → rounds to 0 or 1
  // The node returns outputs only when kTax > 0, so we just confirm a small positive value
  const result = compute({
    net_unearned_income: 2_601,
    parent_taxable_income: 80_000,
    parent_filing_status: FilingStatus.MFJ,
    parent_tax: 9_000,
  });
  const s2 = findOutput(result, "schedule2");
  // parent_tax supplied (9000) may be higher than computed tax on 80001 → kTax could be 0
  // The key invariant: if outputs present, field is line17d_kiddie_tax with a positive value
  if (s2 !== undefined) {
    assertEquals((s2.fields.line17d_kiddie_tax as number) > 0, true);
  } else {
    assertEquals(result.outputs.length, 0);
  }
});

// ─── Kiddie Tax Computation ───────────────────────────────────────────────────

Deno.test("kiddie tax — MFJ parent, $5k NUI", () => {
  // Taxable NUI = $5,000 - $2,600 = $2,400
  // Both lookups are Tax Table lookups (Form 8615 line 9 and the parent's own line 16).
  // Tax on $82,400: band 82,400–82,450, midpoint $82,425
  //   → $2,385 + ($82,425 − $23,850) × 12% = $9,414
  // Parent tax on $80,000: band 80,000–80,050, midpoint $80,025
  //   → $2,385 + ($80,025 − $23,850) × 12% = $9,126
  // Kiddie tax = $9,414 - $9,126 = $288
  const result = compute({
    net_unearned_income: 5_000,
    parent_taxable_income: 80_000,
    parent_filing_status: FilingStatus.MFJ,
    parent_tax: 9_126,
  });
  const s2 = findOutput(result, "schedule2");
  assertEquals(s2?.fields.line17d_kiddie_tax as number, 288);
});

Deno.test("kiddie tax — Single parent, $10k NUI", () => {
  // Taxable NUI = $10,000 - $2,600 = $7,400
  // Tax on $67,400: band 67,400–67,450, midpoint $67,425
  //   → $5,578.50 + ($67,425 − $48,475) × 22% = $9,747.50 → $9,748
  // Parent tax on $60,000: band 60,000–60,050, midpoint $60,025
  //   → $5,578.50 + ($60,025 − $48,475) × 22% = $8,119.50 → $8,120
  // Kiddie tax = $9,748 - $8,120 = $1,628
  const result = compute({
    net_unearned_income: 10_000,
    parent_taxable_income: 60_000,
    parent_filing_status: FilingStatus.Single,
    parent_tax: 8_120,
  });
  const s2 = findOutput(result, "schedule2");
  assertEquals(s2?.fields.line17d_kiddie_tax as number, 1_628);
});

Deno.test("kiddie tax — MFS parent, $5k NUI exact value", () => {
  // Taxable NUI = $5,000 - $2,600 = $2,400
  // Tax on $42,400 MFS: band 42,400–42,450, midpoint $42,425
  //   → $1,192.50 + ($42,425 − $11,925) × 12% = $4,852.50 → $4,853
  // Parent tax on $40,000: band 40,000–40,050, midpoint $40,025
  //   → $1,192.50 + ($40,025 − $11,925) × 12% = $4,564.50 → $4,565
  // Kiddie tax = $4,853 - $4,565 = $288
  const result = compute({
    net_unearned_income: 5_000,
    parent_taxable_income: 40_000,
    parent_filing_status: FilingStatus.MFS,
    parent_tax: 4_565,
  });
  const s2 = findOutput(result, "schedule2");
  assertEquals(s2?.nodeType, "schedule2");
  assertEquals(s2?.fields.line17d_kiddie_tax as number, 288);
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

Deno.test("zero parent income — tax computed from zero base", () => {
  // Parent income = 0; taxable NUI = $5,000 - $2,600 = $2,400
  // Tax on $2,400: band 2,400–2,425 ($25 wide below $3,000), midpoint $2,412.50
  //   → $2,412.50 × 10% = $241.25 → $241
  // Parent tax = $0, so kiddie tax = $241
  const result = compute({
    net_unearned_income: 5_000,
    parent_taxable_income: 0,
    parent_filing_status: FilingStatus.MFJ,
    parent_tax: 0,
  });
  const s2 = findOutput(result, "schedule2");
  assertEquals(s2?.fields.line17d_kiddie_tax as number, 241);
});

Deno.test("very large NUI — kiddie tax computed at high bracket", () => {
  // Taxable NUI = $200,000 - $2,600 = $197,400
  // Parent income $400,000 MFJ
  // MFJ brackets: over $394,600 → 32% base $80,398
  // Tax on $597,400: base $80,398 + ($597,400 - $394,600) × 32% = $80,398 + $64,896 = $145,294
  //   Wait — $597,400 > $501,050, so in 35% bracket (base $114,462)
  //   $114,462 + ($597,400 - $501,050) × 35% = $114,462 + $33,722.50 = $148,184.50
  // Tax on $400,000 MFJ: over $394,600 at 32%
  //   $80,398 + ($400,000 - $394,600) × 32% = $80,398 + $1,728 = $82,126
  // $597,400 is over $100,000, so the Tax Computation Worksheet: Section B 35% row,
  //   0.35 × $597,400 − $60,905.50 = $148,184.50 → $148,185
  // Parent tax on $400,000, Section B 32% row: 0.32 × $400,000 − $45,874 = $82,126
  // Kiddie tax = $148,185 - $82,126 = $66,059
  const result = compute({
    net_unearned_income: 200_000,
    parent_taxable_income: 400_000,
    parent_filing_status: FilingStatus.MFJ,
    parent_tax: 82_126,
  });
  const s2 = findOutput(result, "schedule2");
  assertEquals(s2?.nodeType, "schedule2");
  assertEquals(s2?.fields.line17d_kiddie_tax as number, 66_059);
});

// ─── Output Routing ───────────────────────────────────────────────────────────

Deno.test("output routes to schedule2 line17d_kiddie_tax", () => {
  const result = compute({
    net_unearned_income: 5_000,
    parent_taxable_income: 80_000,
    parent_filing_status: FilingStatus.MFJ,
    parent_tax: 9_126,
  });
  const s2 = findOutput(result, "schedule2");
  assertEquals(s2?.nodeType, "schedule2");
  assertEquals(s2?.fields.line17d_kiddie_tax as number, 288);
});
