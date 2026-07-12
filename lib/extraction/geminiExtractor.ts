// Default LabelExtractor adapter: one structured-output Gemini call per label, given
// value-guided hints (field names + the application's expected values), returns
// transcription for every field plus model-judged status/explanation for fuzzy fields
// and a bold-confidence signal for the Government Warning — all in one response, not
// one call per field. Model choice (gemini-3.1-flash-lite) and latency numbers (~1.7-2.2s
// per call) were validated empirically against the real API before this was built.

import type { ApplicationData, MatchStatus } from "../types";
import type { ExtractedFuzzyField, ExtractedWarningField, LabelExtractor, LabelFields, LabelImage } from "./types";

/** The one field that gets the bold-confidence shape instead of the fuzzy shape. */
const WARNING_FIELD = "warningText";

/**
 * Pinned (not the "-latest" alias) for reproducibility during this build — re-verify
 * this is still available before relying on it if this code is revisited later, since
 * Gemini model IDs can shift between provider releases.
 */
const GEMINI_MODEL = "gemini-3.1-flash-lite";

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Reads the Gemini API key from the environment. Throws immediately if it's unset —
 * no fallback, no default, secrets are never hardcoded. Called on every `extract()`
 * invocation rather than cached at module load, so a missing key fails loudly the
 * moment extraction is actually attempted.
 */
function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set. Copy .env.local.example to " +
        ".env.local and set a real key (see https://aistudio.google.com/apikey)."
    );
  }
  return apiKey;
}

/**
 * Builds the value-guided extraction prompt sent alongside the image. For every field
 * present in the application (`hints`), tells the model the field's name and its
 * expected value as a search hint, then spells out exactly which of the two response
 * shapes (Government Warning/bold-signal, or fuzzy/status-judged) applies to which
 * field, so the model's JSON output can be parsed back into `LabelFields` without
 * guessing. The expected value is given as a hint (not withheld) because real labels
 * aren't headed like form fields — the model needs to know what it's looking for to
 * locate genuinely unlabeled text.
 *
 * `alcoholContent` and `netContents` get extra, field-specific instructions layered on
 * top of the general fuzzy-field guidance: exact numeric equality only (no rounding, no
 * "close enough"), and for `netContents`, same-system metric conversion is acceptable
 * but cross-system (metric/imperial) conversion must never be treated as a match. This
 * is where the no-tolerance/no-conversion guarantee that used to live in
 * `numericMatch.ts`/`unitMatch.ts` now has to come from instead, per the 2026-07-10
 * architecture revision — see this file's header comment.
 */
function buildPrompt(hints: ApplicationData): string {
  // List every field the caller wants checked, skipping any explicitly-undefined
  // entries (ApplicationData's index signature allows undefined values for fields
  // absent from a given application).
  const fieldLines = Object.entries(hints)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([field, expectedValue]) => `- "${field}": expected value on the application is "${expectedValue}"`)
    .join("\n");

  return `You are inspecting a photo of an alcohol beverage label for a TTB compliance check.
For each field listed below, locate the corresponding text on the label image and
transcribe it exactly as it appears there (foundText). The "expected value" given for
each field is only a search hint to help you find the right text on the label — it is
not necessarily correct. Report what the label actually says, not the expected value,
even if they differ.

Fields to find:
${fieldLines}

Respond with a single JSON object with exactly one top-level key per field listed above.
Each field's value must be an object shaped according to which kind of field it is:

1. If the field name is "warningText": transcription, plus a visual check of whether
   the "GOVERNMENT WARNING:" prefix is rendered bold. Judge this by directly comparing
   the prefix's character stroke weight against the warning body text immediately
   following it on the same label — do not judge the prefix in isolation, and do not
   assume it is bold just because Government Warnings are conventionally printed in
   bold; judge only what is actually visible in this specific image.
   - Set "isWarningBold" to true only if the prefix's strokes are visibly thicker/
     heavier than the body text right next to it; set it to false if the prefix and
     body appear the same weight.
   - Set "boldConfident" to true only if you can clearly compare the two side by side
     and are confident in that specific comparison; set it to false if image
     resolution, angle, lighting, or a stylized font makes this particular comparison
     genuinely hard to judge.
   Shape: { "foundText": string, "isWarningBold": boolean, "boldConfident": boolean }

2. For every other field name: transcription, plus your own judgment of whether the
   label's text matches the expected value in substance (minor formatting differences
   are fine; a different brand, producer, place, or class/type is not), as one of
   "matched", "needs_review", or "mismatched", with a short one-sentence explanation of
   your reasoning.
   Shape: { "foundText": string, "status": "matched" | "needs_review" | "mismatched", "explanation": string }

   Two fields need a stricter standard than the general "minor formatting differences
   are fine" guidance above:

   - "alcoholContent": judge this using EXACT numeric equality only. No rounding, and
     no "close enough" — even a tiny difference (e.g. 44.9% vs 45%) is a mismatch, not
     a near-match.
   - "netContents": also judge this using EXACT equality only, with one specific
     exception: converting between units within the same measurement system is
     acceptable and should be judged "matched" if the converted quantities are exactly
     equal (e.g. "750 mL" on the application and "0.75 L" on the label are the same
     quantity in the metric system). But converting between measurement systems
     (metric to imperial or vice versa — e.g. mL to fluid ounces) must NEVER be
     treated as a match, even if the underlying volume happens to be the same — judge
     that as "mismatched" or "needs_review" instead, never a silent conversion.

If a field's text cannot be found anywhere on the label, set "foundText" to an empty
string, and use "mismatched" with an explanation stating it was not found.

Respond with only the JSON object — no markdown code fences, no commentary before or
after it.`;
}

/**
 * Narrows an arbitrary value from the parsed Gemini response into a valid MatchStatus.
 * Defensive default: a status the model returned that isn't one of the three known
 * values is treated as "needs_review" rather than silently trusted as a match or
 * hidden as a mismatch — an untrusted external response should never fail open or
 * closed without the agent seeing it flagged.
 */
function normalizeStatus(value: unknown): MatchStatus {
  if (value === "matched" || value === "needs_review" || value === "mismatched") {
    return value;
  }
  return "needs_review";
}

/**
 * Converts the raw, untyped JSON object parsed from Gemini's response into a properly
 * shaped `LabelFields`, validating as it goes since this is an external API boundary
 * and the response can't be trusted as-is. Walks the field names from `hints` (never
 * the response's own keys) so a field the model omitted, renamed, or invented can't
 * silently slip through or get lost — every field the caller asked about ends up with
 * an entry, defaulting to "not found" rather than being dropped if the model's
 * response is missing it.
 */
function normalizeLabelFields(parsed: unknown, hints: ApplicationData): LabelFields {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Gemini API returned a JSON payload that was not an object.");
  }
  const rawFields = parsed as Record<string, unknown>;
  const result: LabelFields = {};

  for (const [field, expectedValue] of Object.entries(hints)) {
    if (expectedValue === undefined) {
      continue; // Field absent from this application — nothing to extract or check.
    }

    // The model's response for this field, or an empty object if it omitted the
    // field entirely — treated below as "found nothing", not as a thrown error, so
    // one missing field doesn't fail the whole extraction call.
    const rawFieldValue = rawFields[field];
    const rawField: Record<string, unknown> =
      typeof rawFieldValue === "object" && rawFieldValue !== null
        ? (rawFieldValue as Record<string, unknown>)
        : {};

    const foundText = typeof rawField.foundText === "string" ? rawField.foundText : "";

    if (field === WARNING_FIELD) {
      const warningField: ExtractedWarningField = {
        foundText,
        isWarningBold: rawField.isWarningBold === true,
        boldConfident: rawField.boldConfident === true,
      };
      result[field] = warningField;
    } else {
      // Every field other than warningText — including alcoholContent/netContents as
      // of the 2026-07-10 architecture revision — gets the fuzzy, model-judged shape.
      const fuzzyField: ExtractedFuzzyField = {
        foundText,
        status: normalizeStatus(rawField.status),
        explanation:
          typeof rawField.explanation === "string" && rawField.explanation.length > 0
            ? rawField.explanation
            : "Model did not provide an explanation for this field.",
      };
      result[field] = fuzzyField;
    }
  }

  return result;
}

/**
 * The default `LabelExtractor` implementation: calls Gemini's `generateContent` REST
 * endpoint directly (no SDK dependency — a single fetch call doesn't warrant one) with
 * the label image and a value-guided prompt, asking for structured JSON output in one
 * round trip rather than one call per field, since output length is a major driver of
 * LLM latency and multiple round-trips would multiply it.
 */
export const geminiExtractor: LabelExtractor = {
  async extract(image: LabelImage, hints: ApplicationData): Promise<LabelFields> {
    const apiKey = getApiKey();
    const prompt = buildPrompt(hints);

    // Gemini's `generateContent` request body: one "user" turn with two parts — the
    // text prompt, and the label image as inline base64 data. `responseMimeType:
    // "application/json"` asks Gemini to constrain its output to parseable JSON
    // (validated by structured output on the backend), matching what Phase 0's spike
    // confirmed works reliably for this exact use case.
    const requestBody = {
      contents: [
        {
          parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API request failed with status ${response.status}: ${errorBody}`);
    }

    const responseBody = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    // The generated text lives at candidates[0].content.parts[0].text — Gemini's
    // standard generateContent response shape. Anything missing along this path means
    // the response wasn't shaped the way this code expects, so fail loudly instead of
    // returning a half-built result.
    const rawText = responseBody.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof rawText !== "string") {
      throw new Error("Gemini API response did not contain the expected generated text.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Gemini API returned text that was not valid JSON: ${message}`);
    }

    return normalizeLabelFields(parsedJson, hints);
  },
};
