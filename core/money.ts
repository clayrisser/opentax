/**
 * money.ts — whole-dollar rounding for every amount the graph passes between nodes.
 *
 * Instructions for Form 1040 (2025), "Rounding Off to Whole Dollars", p. 23:
 *
 *   "You can round off cents to whole dollars on your return and schedules. If you do
 *    round to whole dollars, you must round all amounts. To round, drop amounts under
 *    50 cents and increase amounts from 50 to 99 cents to the next dollar."
 *
 * That same paragraph then adds: "If you have to add two or more amounts to figure the
 * amount to enter on a line, include cents when adding the amounts and round off only
 * the total." This engine deliberately does NOT follow that refinement. TurboTax and
 * TaxAct round each amount as it is entered, so by the time amounts are added they are
 * already whole, and the target for this engine is to agree with those two to the
 * dollar. Rounding at the node boundary is what reproduces them.
 *
 * A consequence worth knowing: a sum of rounded entries can differ by a dollar or two
 * from the rounded sum of the exact entries. That difference is the filing-software
 * convention, not an error.
 */

/**
 * Round half away from zero to a whole dollar.
 *
 * The value is snapped to cents first. That is not cosmetic: an exact half-dollar
 * reached by multiplication often arrives one ULP low (90 x 0.35 is 31.499999999999996,
 * 1500 x 0.009 is 13.499999999999998), and rounding straight to dollars would take those
 * down instead of up. Snapping to cents restores the exact half, and the dollar step is
 * then integer arithmetic with no float involved.
 */
export function roundToWholeDollars(amount: number): number {
  if (!Number.isFinite(amount)) return amount;
  const cents = Math.round(amount * 100);
  const sign = cents < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(cents) + 50) / 100);
}

/**
 * Field names that carry something other than an amount of money and must therefore
 * survive unrounded. Rounding only ever changes a fractional value, so this list holds
 * exactly the fields that are legitimately fractional and are not dollars: rates,
 * percentages, fractions and physical quantities.
 *
 * Derived by reading every `z.number()` declaration under forms/ whose name contains a
 * rate, percentage, fraction or unit word, then dropping the ones that turned out to be
 * money after all (`rate_28_gain`, `box4b_28pct_rate_gain`, `line18_28pct_gain`,
 * `registration`, `factoring_income`, `extraterritorial_income_excluded`,
 * `ltc_accelerated_death_benefits`, `collectibles_gain`). Integer-valued counts such as
 * `personal_use_days` need no entry — rounding an integer is a no-op — but the day,
 * month and week fields are listed anyway so the intent is on the record.
 *
 * Add to this list when a new non-money fractional field is introduced.
 */
export const NON_MONEY_FIELDS: ReadonlySet<string> = new Set([
  // rates, percentages and fractions
  "applicable_fraction",
  "box9a_pct_total",
  "business_use_pct",
  "credit_percentage",
  "credit_rate",
  "credit_rate_override",
  "interest_rate",
  "mcc_rate",
  "occupancy_percent",
  "ownership_percent",
  "partner_tax_rate",
  "saf_ghg_reduction_percentage",
  "subsidy_rate",
  "wage_replacement_pct",
  // physical quantities
  "aviation_gas_farming_gallons",
  "aviation_gas_noncommercial_gallons",
  "battery_storage_kwh_capacity",
  "business_miles",
  "cng_offhighway_gallons",
  "diesel_farming_gallons",
  "diesel_offhighway_gallons",
  "gallons",
  "gallons_agri_biodiesel",
  "gallons_biodiesel",
  "gallons_renewable_diesel",
  "gallons_saf",
  "gallons_ulsd_produced",
  "gasoline_farming_gallons",
  "gasoline_offhighway_gallons",
  "home_office_sq_ft",
  "kerosene_aviation_gallons",
  "kerosene_farming_gallons",
  "kerosene_offhighway_gallons",
  "kwh_produced",
  "kwh_sold",
  "line_44a_total_miles",
  "line_44b_business_miles",
  "line_44c_commuting_miles",
  "line_44d_other_miles",
  "lpg_offhighway_gallons",
  "quantity",
  "shares_owned",
  "total_miles",
  "units_produced",
  "units_sold",
  // hours, days, months, weeks
  "child_care_months",
  "days_excluded_current_year",
  "days_in_foreign_country",
  "days_in_us_current_year",
  "days_in_us_prior_year_1",
  "days_in_us_prior_year_2",
  "days_owned_in_year",
  "educator1_hours_worked",
  "educator2_hours_worked",
  "fair_rental_days",
  "holding_period_days",
  "hours_worked",
  "ltc_period_days",
  "months_in_home",
  "months_of_hdhp_coverage",
  "personal_use_days",
  "qualifying_days",
  "total_days_in_period",
  "weeks_leave",
]);

/**
 * Round every money amount in a set of fields, recursing through arrays and nested
 * objects. A field named in NON_MONEY_FIELDS, and anything that is not a number, passes
 * through untouched.
 *
 * Used on both ends of the graph: on the typed entries going in, so each one is rounded
 * the way it would be typed into TurboTax, and on every field a node passes downstream,
 * so each form line is a whole-dollar entry.
 */
export function roundFields(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = NON_MONEY_FIELDS.has(key) ? value : roundValue(value);
  }
  return out;
}

function roundValue(value: unknown): unknown {
  if (typeof value === "number") return roundToWholeDollars(value);
  if (Array.isArray(value)) return value.map(roundValue);
  if (value !== null && typeof value === "object") {
    return roundFields(value as Record<string, unknown>);
  }
  return value;
}
