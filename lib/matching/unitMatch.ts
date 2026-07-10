// Net Contents matcher: parses value + unit (space-insensitive), normalizes unit
// spelling, requires both to match exactly — no cross-unit conversion.
//
// This is one of the three fully algorithmic fields, same rationale as
// numericMatch.ts: the extractor only ever transcribes text, it never returns a
// status for netContents. The one thing this matcher deliberately does NOT do is
// convert between units — "750 mL" vs "750 L" is a mismatch even though a human
// glancing at it might read past the unit and see "the same 750". A numeric-only
// comparison would silently miss that kind of real unit error, which is exactly the
// case this field exists to catch.

import type { FieldResult } from "../types";
import type { ExtractedFieldBase } from "../extraction/types";

/**
 * Spelling/casing variants that all refer to the SAME physical unit, canonicalized
 * to one lowercase token. This table only ever merges different spellings of one
 * unit into itself — it never maps one unit onto a different unit (e.g. mL and L
 * each canonicalize to their own separate token, and are never made to compare equal
 * to each other). Keys are pre-normalized (lowercased, periods stripped) before this
 * table is consulted — see `normalizeUnit` below.
 */
const UNIT_SPELLING_ALIASES: Record<string, string> = {
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  floz: "floz",
  "fl oz": "floz",
  "fluid ounce": "floz",
  "fluid ounces": "floz",
  gal: "gal",
  gallon: "gal",
  gallons: "gal",
};

/**
 * Canonicalizes a unit string's spelling/casing so that e.g. "mL", "ML", and
 * "milliliters" all compare equal — but a genuinely different unit never does.
 * Unrecognized units pass through lowercased/trimmed rather than throwing, so an
 * unusual unit spelling still gets compared literally instead of silently failing.
 */
function normalizeUnit(rawUnit: string): string {
  const cleaned = rawUnit.trim().toLowerCase().replace(/\./g, "");
  return UNIT_SPELLING_ALIASES[cleaned] ?? cleaned;
}

/** Matches a leading number (optionally decimal) followed by a unit made of letters/spaces/periods, e.g. "750 mL" or "12 fl oz". */
const VALUE_UNIT_REGEX = /^(\d+(?:\.\d+)?)\s*([A-Za-z. ]+)$/;

/**
 * Parses "<number> <unit>" text into its separate numeric value and normalized unit,
 * whitespace-insensitively (leading/trailing/internal spacing around the number and
 * unit doesn't matter). Returns null if the text isn't shaped as a number followed by
 * a unit at all.
 */
function parseValueAndUnit(text: string): { value: number; unit: string } | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  const match = normalized.match(VALUE_UNIT_REGEX);
  if (!match) {
    return null;
  }
  return { value: Number(match[1]), unit: normalizeUnit(match[2]) };
}

/**
 * Matches the Net Contents field: parses a number and a unit out of both the
 * application's expected value and the label's transcribed text, normalizes unit
 * spelling only (never converts between units), and requires both the number and the
 * unit to match exactly for a "matched" result.
 */
export function matchNetContents(
  fieldName: string,
  applicationValue: string,
  extracted: ExtractedFieldBase
): FieldResult {
  const extractedValue = extracted.foundText;
  const applicationParsed = parseValueAndUnit(applicationValue);
  const labelParsed = parseValueAndUnit(extractedValue);

  // If either side isn't parseable as "<number> <unit>" at all, there's nothing to
  // compare — treat as a mismatch rather than silently passing.
  if (!applicationParsed || !labelParsed) {
    return {
      field: fieldName,
      applicationValue,
      extractedValue,
      status: "mismatched",
    };
  }

  // Both the numeric value AND the unit must match exactly. Deliberately no
  // cross-unit conversion — "750 mL" vs "750 L" fails here even though the
  // underlying quantities differ by 1000x, precisely because that's a real error
  // this field is meant to catch, not paper over.
  const matches = applicationParsed.value === labelParsed.value && applicationParsed.unit === labelParsed.unit;

  return {
    field: fieldName,
    applicationValue,
    extractedValue,
    status: matches ? "matched" : "mismatched",
  };
}
