// Vitest coverage for the Alcohol Content matcher: exact numeric equality, with the
// two cases straight from the architecture doc's own worked examples.

import { describe, expect, it } from "vitest";
import { matchAlcoholContent } from "./numericMatch";
import type { ExtractedFieldBase } from "../extraction/types";

describe("matchAlcoholContent", () => {
  it("matches when the parsed percentage is the same, even with extra surrounding text", () => {
    const extracted: ExtractedFieldBase = { foundText: "45% Alc./Vol. (90 Proof)" };

    const result = matchAlcoholContent("alcoholContent", "45% Alc./Vol.", extracted);

    expect(result.status).toBe("matched");
  });

  it("mismatches on any numeric difference, however small — no rounding tolerance", () => {
    const extracted: ExtractedFieldBase = { foundText: "44.9%" };

    const result = matchAlcoholContent("alcoholContent", "45%", extracted);

    expect(result.status).toBe("mismatched");
  });
});
