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

  it("matches when the application (not just the label) has the proof text", () => {
    // Proof is only present on one side here, so there's nothing to compare it
    // against — not required to match, same as any value the application doesn't
    // state. Only the parsed percentage is compared in this case.
    const extracted: ExtractedFieldBase = { foundText: "45% Alc./Vol." };

    const result = matchAlcoholContent("alcoholContent", "45% Alc./Vol. (90 Proof)", extracted);

    expect(result.status).toBe("matched");
  });

  it("mismatches on any numeric difference, however small — no rounding tolerance", () => {
    const extracted: ExtractedFieldBase = { foundText: "44.9%" };

    const result = matchAlcoholContent("alcoholContent", "45%", extracted);

    expect(result.status).toBe("mismatched");
  });

  it("mismatches when both sides state a proof number and they disagree, even though the percentage matches", () => {
    // A typo in just the proof portion (90 -> 91) must not slip through just because
    // the percentage itself happens to be correct.
    const extracted: ExtractedFieldBase = { foundText: "45% Alc./Vol. (91 Proof)" };

    const result = matchAlcoholContent("alcoholContent", "45% Alc./Vol. (90 Proof)", extracted);

    expect(result.status).toBe("mismatched");
  });

  it("matches when both sides state the same proof number alongside the same percentage", () => {
    const extracted: ExtractedFieldBase = { foundText: "45% Alc./Vol. (90 Proof)" };

    const result = matchAlcoholContent("alcoholContent", "45% Alc./Vol. (90 Proof)", extracted);

    expect(result.status).toBe("matched");
  });
});
