// Vitest coverage for the Net Contents matcher: exact number + unit match, with the
// two cases straight from the architecture doc's own worked examples — including the
// deliberate no-conversion mismatch.

import { describe, expect, it } from "vitest";
import { matchNetContents } from "./unitMatch";
import type { ExtractedFieldBase } from "../extraction/types";

describe("matchNetContents", () => {
  it("matches when the number and unit are identical", () => {
    const extracted: ExtractedFieldBase = { foundText: "750 mL" };

    const result = matchNetContents("netContents", "750 mL", extracted);

    expect(result.status).toBe("matched");
  });

  it("mismatches on a unit difference even when the number is the same — no cross-unit conversion", () => {
    const extracted: ExtractedFieldBase = { foundText: "750 L" };

    const result = matchNetContents("netContents", "750 mL", extracted);

    expect(result.status).toBe("mismatched");
  });
});
