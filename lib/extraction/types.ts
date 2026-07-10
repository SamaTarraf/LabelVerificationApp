// LabelExtractor interface, LabelFields type. extract() takes the application's field
// names *and* expected values as search hints, not just the image (value-guided
// extraction) — real labels aren't headed like form fields, so the model needs to know
// what it's looking for.
//
// As of a 2026-07-10 architecture revision, only Government Warning (`warningText`)
// remains a fully algorithmic field at the type level below — its shape carries no
// status because its match decision is made later, in deterministic matcher code.
// `alcoholContent` and `netContents` used to be status-free the same way, but now
// carry `status`+`explanation` like every other field: their match decision is made
// by the model in this same extraction call.

import type { ApplicationData, MatchStatus } from "../types";

/**
 * The image handed to a LabelExtractor. Represented as base64-encoded bytes + a MIME
 * type (rather than a browser File/Blob or a Node Buffer) so this interface stays
 * usable from both server and, in principle, browser code, and maps directly onto
 * Gemini's `inlineData` request part without an extra conversion step at the call site.
 */
export type LabelImage = {
  /** Base64-encoded image bytes, with no `data:` URL prefix. */
  base64: string;
  /** e.g. "image/jpeg", "image/png" — passed straight through to the extractor's API call. */
  mimeType: string;
};

/**
 * The minimum every extracted field returns: the text the extractor found on the label
 * for that field, transcribed as-is (the model is asked to report what's actually on
 * the label, not to echo the expected value it was given as a hint). Not returned
 * standalone by itself for any field — it's the common base that `ExtractedWarningField`
 * and `ExtractedFuzzyField` both extend with their own additional properties.
 */
export type ExtractedFieldBase = {
  foundText: string;
};

/**
 * The Government Warning's extracted shape: transcription plus a best-effort visual
 * signal for whether the "GOVERNMENT WARNING:" prefix appears bold, and how confident
 * the model is in that specific visual judgment. `isWarningBold` and `boldConfident`
 * are deliberately two separate booleans, not one tri-state value — an unconfident
 * answer must be treated as inconclusive (`needs_review`) rather than trusted as either
 * "bold" or "not bold".
 */
export type ExtractedWarningField = ExtractedFieldBase & {
  isWarningBold: boolean;
  boldConfident: boolean;
};

/**
 * The extracted shape for every field whose match decision is made by the model during
 * this same extraction call, rather than by separate matcher code downstream: the
 * fuzzy/open-category fields (brand name, class/type, producer, country of origin, or
 * any application field that isn't one of the two named below), plus — as of a
 * 2026-07-10 architecture revision — `alcoholContent` and `netContents` too. Those two
 * were originally fully algorithmic (parsed and compared as numbers in deterministic
 * matcher code), but moved into this model-judged category to ship a complete app
 * across all fields sooner; the no-
 * tolerance/no-conversion guarantee that used to come from code now has to come from
 * the extraction prompt instead (see `geminiExtractor.ts`'s `buildPrompt()`) — a real,
 * deliberately accepted trade-off in guarantee strength, not an oversight. `explanation`
 * is required (not optional) here: a status without a stated reason would leave a
 * `needs_review`/`mismatched` result with nothing to show the agent reviewing it.
 */
export type ExtractedFuzzyField = ExtractedFieldBase & {
  status: MatchStatus;
  explanation: string;
};

/** The union of every possible per-field extraction shape a LabelExtractor can return. */
export type ExtractedField = ExtractedFieldBase | ExtractedWarningField | ExtractedFuzzyField;

/**
 * The full result of one extraction call: one entry per field the caller asked about
 * (i.e. every key present in the `hints` passed to `extract()`), keyed by field name.
 * `warningText` is called out explicitly with its bold-signal shape because Government
 * Warning is the one field that stays fully algorithmic — its match decision is made
 * later by `exactMatch.ts`, never by the model. `alcoholContent` and `netContents` are
 * called out explicitly too, but with the *fuzzy* shape, not a status-free one: as of
 * a 2026-07-10 architecture revision they're judged directly by the model during this
 * same extraction call, the same way
 * every other field is (see `ExtractedFuzzyField`'s doc comment for why, and
 * `geminiExtractor.ts`'s prompt for the exact-equality/no-conversion instructions that
 * replace the guarantee their old algorithmic matchers used to provide in code). Every
 * other key — an open set, mirroring whatever fields the application actually had (see
 * `ApplicationData` in `../types.ts`) — also uses the fuzzy shape, since an unrecognized
 * field defaults to the model's own judgment rather than being silently dropped; the
 * application field set is never hardcoded to a fixed list.
 */
export type LabelFields = {
  alcoholContent?: ExtractedFuzzyField;
  netContents?: ExtractedFuzzyField;
  warningText?: ExtractedWarningField;
  [field: string]: ExtractedField | undefined;
};

/**
 * The swap point for the label extraction engine. Gemini's REST API is the only
 * implementation built for this take-home (`geminiExtractor.ts`), but a local/
 * self-hosted model could implement this same interface later without touching
 * matching logic or API-route code.
 *
 * `extract()` is value-guided: `hints` is the application's own `ApplicationData` for
 * this one label, i.e. both the field *names* to look for (its object keys) and each
 * field's *expected value* (its values), used as a search aid — real labels don't have
 * headers like "Brand Name:" identifying which text is which, so the model needs to be
 * told what it's looking for. Accepted trade-off: giving the model the expected value
 * while it searches introduces some anchoring risk, mitigated by keeping the model's
 * role for strict fields limited to transcription only, never the match decision.
 */
export interface LabelExtractor {
  extract(image: LabelImage, hints: ApplicationData): Promise<LabelFields>;
}
