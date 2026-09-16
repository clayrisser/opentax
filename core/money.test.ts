import { assertEquals } from "@std/assert";
import { NON_MONEY_FIELDS, roundFields, roundToWholeDollars } from "./money.ts";

Deno.test("rounding follows the IRS rule: under 50 cents down, 50 through 99 up", () => {
  // "To round, drop amounts under 50 cents and increase amounts from 50 to 99 cents to
  // the next dollar. For example, $1.39 becomes $1 and $2.50 becomes $3."
  assertEquals(roundToWholeDollars(1.39), 1);
  assertEquals(roundToWholeDollars(2.50), 3);
  assertEquals(roundToWholeDollars(0.49), 0);
  assertEquals(roundToWholeDollars(0.50), 1);
  assertEquals(roundToWholeDollars(0.99), 1);
  assertEquals(roundToWholeDollars(1_087.50), 1_088);
});

Deno.test("a whole dollar is left exactly where it is", () => {
  for (const n of [0, 1, 42, 15_750, 176_100, 9_012_592]) {
    assertEquals(roundToWholeDollars(n), n);
  }
});

Deno.test("negative amounts round away from zero, the same distance as positive ones", () => {
  // Math.round would send −2.5 up to −2; a loss and a gain of the same size have to
  // round by the same amount or a netted pair stops cancelling.
  assertEquals(roundToWholeDollars(-2.50), -3);
  assertEquals(roundToWholeDollars(-1.39), -1);
  assertEquals(roundToWholeDollars(-0.50), -1);
  assertEquals(roundToWholeDollars(-0.49), 0);
});

Deno.test("an exact half that arrives a ULP low still rounds up", () => {
  // These are the two live rates that produce a short half: 90 × 0.35 is
  // 31.499999999999996 and 1500 × 0.009 is 13.499999999999998. Rounding straight to
  // dollars would take both down. Rounding through cents restores them.
  assertEquals(90 * 0.35 < 31.5, true, "precondition: the product really is short");
  assertEquals(roundToWholeDollars(90 * 0.35), 32);
  assertEquals(1_500 * 0.009 < 13.5, true, "precondition: the product really is short");
  assertEquals(roundToWholeDollars(1_500 * 0.009), 14);
});

Deno.test("every 35% and 0.9% product across a wide range rounds like exact arithmetic", () => {
  // Exhaustive over the range where a half-dollar can appear: 0.35 × n lands on a half
  // when n ≡ 10 (mod 20), and 0.009 × n when n ≡ 500 (mod 1000).
  for (let n = 0; n <= 200_000; n += 10) {
    assertEquals(roundToWholeDollars(n * 0.35), Math.floor((n * 35 + 50) / 100), `0.35 × ${n}`);
  }
  for (let n = 0; n <= 2_000_000; n += 500) {
    assertEquals(roundToWholeDollars(n * 0.009), Math.floor((n * 9 + 500) / 1000), `0.009 × ${n}`);
  }
});

Deno.test("roundFields rounds numbers, arrays and nested objects, and leaves the rest alone", () => {
  const rounded = roundFields({
    line15_taxable_income: 24_119.636,
    line1a_wages: [50_000.4, 50_000.6],
    filing_status: "single",
    box13_statutory_employee: true,
    nested: { amount: 1.5 },
    nothing: null,
  });
  assertEquals(rounded.line15_taxable_income, 24_120);
  assertEquals(rounded.line1a_wages, [50_000, 50_001]);
  assertEquals(rounded.filing_status, "single");
  assertEquals(rounded.box13_statutory_employee, true);
  assertEquals(rounded.nested, { amount: 2 });
  assertEquals(rounded.nothing, null);
});

Deno.test("a field that is not money keeps its fraction", () => {
  const rounded = roundFields({
    business_use_pct: 0.75,
    mcc_rate: 0.2,
    gallons: 137.4,
    applicable_fraction: 0.8333,
  });
  assertEquals(rounded.business_use_pct, 0.75);
  assertEquals(rounded.mcc_rate, 0.2);
  assertEquals(rounded.gallons, 137.4);
  assertEquals(rounded.applicable_fraction, 0.8333);
});

Deno.test("the 28% gain fields are money despite the rate word in their names", () => {
  // rate_28_gain, box4b_28pct_rate_gain and line18_28pct_gain are dollar amounts of
  // collectibles gain, not rates, and must not be on the exemption list.
  for (const name of ["rate_28_gain", "box4b_28pct_rate_gain", "line18_28pct_gain"]) {
    assertEquals(NON_MONEY_FIELDS.has(name), false, name);
  }
  assertEquals(roundFields({ rate_28_gain: 1_000.5 }).rate_28_gain, 1_001);
});
