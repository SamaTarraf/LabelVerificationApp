// Vitest coverage for the Government Warning matcher: body wording, the ALL CAPS
// prefix check, and the best-effort bold check, including the fixed explanation
// string owned by this file (never model-generated) for the bold-uncertain case.

import { describe, expect, it } from "vitest";
import { BOLD_UNCERTAIN_EXPLANATION, matchGovernmentWarning } from "./exactMatch";
import type { ExtractedWarningField } from "../extraction/types";

const STANDARD_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink " +
  "alcoholic beverages during pregnancy because of the risk of birth defects. (2) " +
  "Consumption of alcoholic beverages impairs your ability to drive a car or operate " +
  "machinery, and may cause health problems.";

describe("matchGovernmentWarning", () => {
  it("mismatches when the label's prefix is title-cased instead of ALL CAPS", () => {
    const titleCased = STANDARD_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:");
    const extracted: ExtractedWarningField = {
      foundText: titleCased,
      isWarningBold: true,
      boldConfident: true,
    };

    const result = matchGovernmentWarning("warningText", STANDARD_WARNING, extracted);

    expect(result.status).toBe("mismatched");
  });

  it("flags needs_review with the fixed explanation when bold styling(extracted as not bold) isn't confidently confirmed, even though the text is correct", () => {
    const extracted: ExtractedWarningField = {
      foundText: STANDARD_WARNING,
      isWarningBold: false,
      boldConfident: false,
    };

    const result = matchGovernmentWarning("warningText", STANDARD_WARNING, extracted);

    expect(result.status).toBe("needs_review");
    expect(result.explanation).toBe(BOLD_UNCERTAIN_EXPLANATION);
  });

    it("flags needs_review with the fixed explanation when bold styling(extracted as bold) isn't confidently confirmed, even though the text is correct", () => {
    const extracted: ExtractedWarningField = {
      foundText: STANDARD_WARNING,
      isWarningBold: true,
      boldConfident: false,
    };

    const result = matchGovernmentWarning("warningText", STANDARD_WARNING, extracted);

    expect(result.status).toBe("needs_review");
    expect(result.explanation).toBe(BOLD_UNCERTAIN_EXPLANATION);
  });

  it("matches when the body matches, the prefix is ALL CAPS, and bold is confidently confirmed", () => {
    const extracted: ExtractedWarningField = {
      foundText: STANDARD_WARNING,
      isWarningBold: true,
      boldConfident: true,
    };

    const result = matchGovernmentWarning("warningText", STANDARD_WARNING, extracted);

    expect(result.status).toBe("matched");
  });

    it("mismatches when the body matches, the prefix is ALL CAPS, and is confidently not bold", () => {
    const extracted: ExtractedWarningField = {
      foundText: STANDARD_WARNING,
      isWarningBold: false,
      boldConfident: true,
    };

    const result = matchGovernmentWarning("warningText", STANDARD_WARNING, extracted);

    expect(result.status).toBe("needs_review");
  });
});
