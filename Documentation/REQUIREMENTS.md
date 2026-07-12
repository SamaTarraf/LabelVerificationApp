# Simplified Requirements — AI-Powered Alcohol Label Verification App

Distilled from `RequirementPrompt.md` (stakeholder interviews contain noise/anecdotes — filtered out below, key signals kept).

## Core Functional Requirements

1. **Label vs. application matching** — Given a label image and the corresponding application data, verify that the label's content matches the application. At minimum check:
   - Brand name
   - Class/type designation
   - Alcohol content (ABV)
   - Net contents
   - Name/address of bottler/producer
   - Country of origin (for imports)
   - Government Health Warning Statement
2. **Government Warning validation is strict** — must be word-for-word exact, with "GOVERNMENT WARNING:" in all caps and bold. Case/formatting deviations (e.g., title case) = fail.
3. **Fuzzy/judgment matching for other fields** — non-warning fields should tolerate trivial formatting differences (e.g., `STONE'S THROW` vs `Stone's Throw` = match), not just strict string equality.
4. **Batch upload** — support processing multiple label applications (e.g., 200–300) in one submission, not just one at a time.
5. **Clear pass/fail + explanation output** — agents need to see what matched, what didn't, and why (supports both "quick check" and "needs judgment" cases).

## Non-Functional Requirements

- **Speed**: results in ~5 seconds per label. (Prior vendor pilot failed because 30–40 sec/label was unusable — agents reverted to manual review.)
- **Usability**: interface must be usable by non-technical users across a wide skill range ("clean, obvious, no hunting for buttons" — benchmark: a 73-year-old first-time user).
- **Standalone prototype**: no integration with the legacy COLA (.NET) system required.
- **Network constraint**: assume outbound traffic to external domains may be blocked/unreliable — avoid hard dependence on external cloud ML APIs if possible, or design gracefully around this constraint.
- **Security/data**: prototype only — no real PII, no production-grade compliance needed, but don't do anything egregiously insecure.

## Explicit Non-Goals / Out of Scope

- No COLA system integration.
- No requirement to handle poor-quality images (bad angles, glare, lighting) — called out by stakeholder as "maybe out of scope for a prototype."
- No production security/compliance hardening.

## Deliverables

1. Source code repository (GitHub or similar):
   - All source code
   - README with setup/run instructions
   - Brief write-up: approach, tools used, assumptions made
2. Deployed, working application URL.

## Evaluation Criteria

- Correctness/completeness of core requirements
- Code quality and organization
- Appropriate technical choices for the scope
- UX and error handling
- Attention to requirements
- Creative problem-solving
- Preference: a working core app with clean code > ambitious but incomplete features. Document trade-offs/limitations explicitly.

## Sample Data

- Reference example: distilled spirits label with Brand Name, Class/Type, Alcohol Content, Net Contents, Government Warning (see prompt for sample values).
- Encouraged to generate/source additional test labels (e.g., via AI image generation).
