# 📋 Plan: LABEL_VERIFICATION_APP

**Created**: 2026-07-09
**Status**: 📝 Draft

Initial build of the AI-Powered Alcohol Label Verification App described in `ARCHITECTURE.md`: a Next.js/TypeScript app, deployed to Vercel, that verifies a label image against its application data. Sequenced so the stateless single-verify flow is scaffolded, built, and demoable before the stateful batch flow (KV/Blob/chunking/locking) is started, per `ARCHITECTURE.md`'s own "two flows, not one" framing.

---

## 🎯 Objective

### Problem Statement

TTB compliance agents currently verify label-vs-application matches by eye, one label at a time, including 200–300-label importer batches processed sequentially. This plan builds the prototype described in `ARCHITECTURE.md` / `REQUIREMENTS.md`: an AI-assisted tool that extracts label fields (value-guided, via Gemini) and checks them against the application, with strict algorithmic matching for the Government Warning, model-judged matching (with explicit exactness instructions) for Alcohol Content and Net Contents, and model-judged matching for everything else — see `ARCHITECTURE.md`'s "Matching" section, revised 2026-07-10 — in both a single-label flow and a batch flow.

### Success Criteria

- [ ] `POST /api/verify` takes one image + one application JSON, returns a `VerificationResult` in ~5s, with zero server-side persistence
- [ ] Single-verify UI (`UploadForm.tsx` + `ResultsTable.tsx`) is demoable end-to-end before batch work starts
- [ ] Batch flow supports a 200–300 label CSV + image upload, preflight pairing confirmation, chunked server-driven processing, resume after refresh/crash, single-active-tab locking
- [x] Results CSV export matches the same-shape-plus-`status`-plus-`flaggedFields` format in `ARCHITECTURE.md`
- [ ] App is deployed to Vercel with a working URL
- [ ] README (setup/run instructions) and short write-up (approach, tools, assumptions) exist per `REQUIREMENTS.md` deliverables
- [ ] None of the `CLAUDE.md` Non-Negotiable Constraints are violated (checked explicitly at Phase Validation steps below)
- [ ] Code is commented throughout per the "💬 Code Commenting Standard" (checked explicitly at each Phase Validation step below, including a retroactive pass on Phase 1)

---

## 🔍 Background & Context

### Current State

Pre-implementation. `LabelVerificationApp/` exists as an empty directory with its own initialized, empty, remote-less git repo — no `package.json`, no scaffold, no commits. The outer repo (this one) contains only planning docs (`RequirementPrompt.md`, `REQUIREMENTS.md`, `ARCHITECTURE.md`, `NOTES.md`, `CLAUDE.md`) and has no commits yet either.

### Why This Matters

This is a take-home evaluation. `REQUIREMENTS.md`'s evaluation criteria weight correctness/completeness of core requirements, code quality, appropriate technical choices, UX/error handling, attention to requirements, and creative problem-solving — with an explicit preference for "a working core application with clean code" over "ambitious but incomplete features." The phase sequencing below (spike → single-verify → batch → deploy) is chosen specifically to guarantee a demoable, working core exists even if time runs out before batch or polish is finished.

### Key Findings from Discussion

- `ARCHITECTURE.md` itself recommends a spike (call Gemini on one real test image, measure latency) *before* building the rest of the app — the ~5s latency target and the batch concurrency cap both depend on numbers that haven't been measured yet. **This spike was run 2026-07-09 — see "✅ Gemini Model, Latency & Concurrency" below for results.**
- Three items were flagged as genuinely unresolved and not to be silently decided by this plan: commit/push cadence, testing strategy scope/depth, and the Gemini concurrency cap `N`. **All three are now resolved** — see "Commit & Push Plan," "🧪 Testing Strategy," and "✅ Gemini Model, Latency & Concurrency" below. This plan has zero remaining open decisions.
- `LabelVerificationApp/`'s nested git repo already exists and is initialized — do not run `git init` there.
- **Model IDs go stale fast — re-verify, don't trust what's written down.** `ARCHITECTURE.md` assumed `gemini-2.5-flash`/`gemini-2.5-flash-lite`; as of the Phase 0 spike, both 404 with "no longer available to new users" on a fresh API key. Working model: `gemini-3.1-flash-lite`. Same lesson as the rate-limit numbers — Google's docs/dashboard are the source of truth at implementation time, not this plan.
- A correction was made to `ARCHITECTURE.md` this session: the Government Warning's bold-uncertainty `needs_review` case must carry a fixed, code-owned `explanation` string (not model-generated), because `applicationValue`/`extractedValue` text can be identical when only the *styling* is in question.
- **Matching architecture revised 2026-07-10, after Phases 2-3 were already implemented and partly committed.** Alcohol Content and Net Contents moved from fully-algorithmic to model-judged (with explicit prompt instructions for exact equality, and for Net Contents, same-system-only unit conversion) — Government Warning is unaffected, stays algorithmic. This is a known, accepted risk against `REQUIREMENTS.md`'s stated exactness requirements, taken deliberately to ship a complete app across all fields sooner; see `ARCHITECTURE.md`'s "Matching" section for the full reasoning. The already-built `numericMatch.ts`/`unitMatch.ts` are not deleted, just not wired in — Phases 2 and 3 below each have a "Post-implementation architecture revision" note listing exactly what code still needs to change to catch up to this decision.
- A correction was made to the CSV export `flaggedFields` format this session: entries are shaped `fieldName (label says <extractedValue>)` **except** when a field carries a fixed or model-generated `explanation` and the extracted text alone wouldn't convey the flag reason (fuzzy-field model reasoning, or the Government Warning's bold-uncertain case) — those use `fieldName (<explanation>)` instead.

---

## 💡 Proposed Approach

### High-Level Strategy

Follow `ARCHITECTURE.md`'s layered pattern (Presentation → Application → Domain → Infrastructure) and its exact Directory Structure as the file manifest for this build — no invented structure. Build bottom-up within each vertical slice: types → extraction adapter → matchers → orchestrator → API route → UI, so each phase has something independently testable before the next phase depends on it. Single-verify is the first complete vertical slice (Phases 1–4) and is fully demoable on its own; batch (Phases 5–9) is added afterward as its own vertical slice that reuses the single-verify domain/extraction layers unchanged.

### Key Technical Decisions

Technical decisions are already made in `ARCHITECTURE.md` and are not re-litigated here — this plan only sequences them into tasks. See `ARCHITECTURE.md`'s "Key Decisions" section for full rationale on: stateless single-verify vs. ephemeral-KV+Blob batch; swappable `LabelExtractor` backed by Gemini free tier (no local implementation built); value-guided extraction; the algorithmic/model-judged matching split; `BatchInputParser` as a swappable interface; the two-zone batch upload UI with preflight confirm; server-driven chunked batch processing with resume and single-tab locking; "Needs Review" as a flag, not a workflow; no accounts; and the CSV export format.

### Alternative Approaches Considered

Not re-covered here — see `ARCHITECTURE.md`'s "Key Decisions" (each subsection states what was considered and rejected, e.g. client-only IndexedDB persistence, a wide-format CSV export, a percentage+threshold fuzzy matcher, a local/self-hosted extractor, `webkitdirectory` folder picker).

---

## ✅ Open Decisions — All Resolved

All three items originally flagged here (commit/push cadence, testing strategy, Gemini concurrency `N`) are now resolved. See "Commit & Push Plan," "🧪 Testing Strategy," and "✅ Gemini Model, Latency & Concurrency" below. This plan has no remaining open decisions blocking `/kickoff`.

---

## ✅ Gemini Model, Latency & Concurrency (resolved 2026-07-09, Phase 0 spike run)

**Model**: `gemini-3.1-flash-lite`, pinned (not the `-latest` alias) for reproducibility during the build — re-verify availability at actual implementation time regardless, since model IDs have already shifted once during planning.

**Latency**: measured 1.72s / 1.87s / 2.23s across three real calls against a synthetic test label (structured JSON output, value-guided extraction with full field hints) — well under `ARCHITECTURE.md`'s assumed ~3-4s budget. Total round-trip (upload + extraction + matching + response) lands around 2.5-3.5s, comfortably inside the 5s target with real margin, not assumed margin. The `maxDuration=8s` / client-abort=10s guards decided earlier remain correctly ordered and now have even more headroom than assumed — no change needed.

**Extraction quality**: value-guided extraction worked as designed on the first attempt — correctly transcribed label text (not just echoing the hint), correct `matched` judgments with real explanations for the three fuzzy fields tested, and correctly detected the bold `GOVERNMENT WARNING:` prefix with a confidence signal. Structured output parsed cleanly, no malformed-JSON retries needed.

**Rate limits (this account, checked directly via AI Studio, not blog aggregators)**: **15 RPM, 500 RPD** on `gemini-3.1-flash-lite`.

**Concurrency cap `N` = 1.** Formula: `N ≤ RPM × (round_duration_seconds / 60) = 15 × (4/60) ≈ 1`. The free tier has no real parallelism headroom at this RPM — `Promise.all(N)` in Phase 7 should still exist as the mechanism (so `N` can scale up later on a paid tier without a rebuild), but wire it as a config value defaulting to `1`, not a larger hardcoded number.

**Batch completion time at N=1**: ~300 labels × ~4s sequential ≈ **20 minutes** for a full batch. RPD is not the binding constraint (300 of 500 daily budget, leaving ~200 for same-day single-verify use) — RPM is a speed limiter, not a capacity blocker.

**Paid tier: not adopted, decision made deliberately.** Tier 1 unlocks automatically just by linking a billing account (no minimum spend required first) and would raise RPM significantly. Actual per-call cost is negligible (~1,600 input / ~300 output tokens per call on Flash-Lite pricing — well under a cent per label, roughly $0.05-$0.15 for a full 300-label batch). The reason not to pay isn't cost — it's that **20 minutes for a 200-300 label batch was confirmed to fit `REQUIREMENTS.md`'s bar as-is**, so adding real billing to a take-home prototype isn't justified by the numbers. Revisit only if a faster live demo becomes a priority — the cost/setup to flip this later is trivial.

---

## ✅ Commit & Push Plan (resolved 2026-07-09)

**Repo structure.** `LabelVerificationApp/` is the sole deliverable repo pushed to GitHub — it already has its own initialized, empty, remote-less git repo (do **not** re-run `git init` there). The outer planning repo (this one — `ARCHITECTURE.md`, `NOTES.md`, `REQUIREMENTS.md`, `RequirementPrompt.md`, `CLAUDE.md`, plan docs) stays local, is never pushed anywhere, and is not part of the submission. `README.md` and the write-up (Phase 10) live inside `LabelVerificationApp/`, not the outer repo — the write-up can port relevant reasoning directly from `ARCHITECTURE.md`'s Trade-offs section and `NOTES.md`'s "educated guess" callouts rather than being written from scratch.

**One-time setup — done 2026-07-09.** Repo created at `github.com/SamaTarraf/LabelVerificationApp`, first commit pushed. Actual default branch is **`main`**, not `master` as originally assumed below.

**Branching — revised 2026-07-10.** No longer "commit straight to `main`" — that's superseded. `main` stays frozen at the last known-working checkpoint (currently: the Phase 1 scaffold's "first commit") and is **not** touched again until there's a deliberate reason to move it forward (e.g. a PR/merge at a meaningful milestone, or right before a Vercel deploy in Phase 10). All in-progress work happens on a single long-lived **`develop`** branch, pushed to `origin/develop` — not a new branch per phase. Phase 2's work landed this way: built on a short-lived `phase2-extraction` branch, fast-forward merged into `develop`, pushed, then the now-redundant branch deleted locally and on GitHub.

**Cadence**:
- Commit locally on `develop` after each `STATE.md` task completes — small, focused commits tied to what was built (e.g. "add Government Warning exact matcher"), not one commit per phase.
- Push `develop` to `origin` at phase boundaries, and only when that phase's slice actually builds/runs — this keeps a known-good branch always available, mirroring the original reasoning for gating pushes (never leave `origin` mid-work in a broken state), just applied to `develop` instead of `main` now.
- `main` only moves when the user explicitly decides to promote `develop` to it (fast-forward or PR) — don't push to `main` as a default action.
- Phase 0's spike script is explicitly excluded from this history: run it, record findings, discard the script (or isolate it under a `scratch/` path that's never committed into `LabelVerificationApp/`) — it's throwaway by design, not a checkpoint.

---

## 🗺️ Implementation Plan

### Phase 0: Empirical Spike ✅ Complete (2026-07-09)

**Goal**: Validate the two load-bearing assumptions in `ARCHITECTURE.md`'s "Latency budget" and "Extraction is value-guided" sections before building anything around them: (1) real Gemini extraction latency on a label image, (2) value-guided extraction actually produces usable structured output. Also gather whatever's available on current Gemini free-tier rate limits to unblock the `N` open decision above.

**Tasks**:
1. [x] **Write a disposable script (not inside `LabelVerificationApp/`'s eventual `/lib` structure)**
   - File(s): ran from the session scratchpad, outside both git repos — never part of the codebase, deleted after findings were recorded
   - Details: a synthetic AI-generated test label (Playwright-rendered HTML, matching `RequirementPrompt.md`'s sample values — "OLD TOM DISTILLERY" bourbon), value-guided hints for all fields, one Gemini structured-output call per run, three runs for consistency. Measured wall-clock latency and inspected the response schema.
   - Estimated effort: Small
2. [x] **Check current Gemini API rate limits and paid-tier pricing**
   - Details: checked directly against the account's AI Studio dashboard (not blog aggregators, which gave inconsistent/unreliable numbers on a first pass) — **15 RPM, 500 RPD** on `gemini-3.1-flash-lite`; paid Tier 1 unlocks via linking a billing account, pay-as-you-go, no minimum spend required
   - Estimated effort: Small

**Validation**:
- [x] Latency: 1.72s / 1.87s / 2.23s across three real calls — well under the ~3-4s extraction budget in `ARCHITECTURE.md`; no change needed to `maxDuration`/client-abort values in Phase 4
- [x] Value-guided extraction produced parseable, correctly-shaped output on every run — correct transcription, correct fuzzy-field judgments with explanations, correct bold-detection with confidence signal
- [x] Spike code and files deleted — see "✅ Gemini Model, Latency & Concurrency" above for the full findings this phase produced

---

### Phase 1: App Scaffold + Core Types

**Goal**: Next.js + TypeScript app exists inside `LabelVerificationApp/`, matching `ARCHITECTURE.md`'s Directory Structure, with shared domain types in place.

**Tasks**:
1. [x] **Scaffold Next.js + TypeScript app inside `LabelVerificationApp/`**
   - File(s): `LabelVerificationApp/` (existing nested repo — do **not** run `git init`; it already exists, empty, no remote)
   - Details: standard Next.js app router scaffold; confirm `package.json`, `tsconfig.json` land inside `LabelVerificationApp/`, not the outer repo
   - Estimated effort: Small
   - Note: `create-next-app` rejects capital letters in the inferred package name (`LabelVerificationApp`), so the scaffold was generated in a scratch dir as `label-verification-app` and its contents (minus its own throwaway `.git`) copied into `LabelVerificationApp/`, preserving the pre-existing empty repo there. Also removed `create-next-app`'s auto-generated `AGENTS.md`/`CLAUDE.md` (not part of this plan's scope, would collide semantically with the outer repo's `CLAUDE.md`).
2. [x] **Create directory skeleton exactly per `ARCHITECTURE.md`'s "Directory Structure"**
   - File(s): `app/`, `components/`, `lib/extraction/`, `lib/matching/`, `lib/batchInput/`, `lib/persistence/`, `lib/export/`
   - Details: create empty/stub files for each path listed in `ARCHITECTURE.md` (`app/page.tsx`, `app/api/verify/route.ts`, etc.) so the structure exists before logic is filled in
   - Estimated effort: Small
   - Note: the four `app/api/**/route.ts` stub files needed a minimal `export {};` (beyond a comment) — Next.js's route type validator requires them to be valid ES modules even before a real HTTP handler is added in Phases 4/7; comment-only files failed `npm run build` with "File is not a module."
3. [x] **`lib/types.ts` — shared domain types**
   - File(s): `LabelVerificationApp/lib/types.ts`
   - Details: `ApplicationData`, `FieldResult` (with optional `explanation`), `VerificationResult`, per `ARCHITECTURE.md`'s "Data Model" section
   - Estimated effort: Small
4. [x] **Create the GitHub remote and push the initial scaffold commit**
   - File(s): none (repo-level action)
   - Details: done manually by the user — `github.com/SamaTarraf/LabelVerificationApp`, private-or-public per their own choice, first commit pushed. Branch is `main`, not `master` as originally assumed in the "Commit & Push Plan" above and the Phase 0 setup snippet — update any future reference to that plan's push commands to use `main`.
   - Estimated effort: Small

**Validation**:
- [x] `npm run dev` starts the scaffolded app with no errors (also confirmed `npm run build` succeeds, `tsc --noEmit` and `eslint .` both clean)
- [x] Directory tree matches `ARCHITECTURE.md`'s Directory Structure listing
- [x] `LabelVerificationApp/.git` had its original (empty) history intact through scaffolding (confirmed no accidental re-init) — a real first commit now exists on `main`, pushed to `origin`
- [x] `LabelVerificationApp/` has a GitHub remote (`origin` → `github.com/SamaTarraf/LabelVerificationApp`) and the initial scaffold commit is pushed
- [x] **Retroactive**: `lib/types.ts` and the stub files reviewed against the "💬 Code Commenting Standard" above (added after this phase was built) — already compliant, no changes needed. `lib/types.ts` has full TSDoc on every type (purpose + rationale, including the dual meaning of `FieldResult.explanation`); every stub file already carries a purpose comment (what it'll do, why, which phase implements it) rather than a bare `export {}`. Real "what the logic does" comments land with each phase's actual implementation, covered by that phase's own checklist item.

---

### Phase 2: Extraction Layer

**Goal**: `LabelExtractor` interface + Gemini adapter, informed by Phase 0's spike findings.

**Tasks**:
1. [x] **`lib/extraction/types.ts` — `LabelExtractor` interface + `LabelFields` type**
   - File(s): `LabelVerificationApp/lib/extraction/types.ts`
   - Details: `extract()` takes the image plus the application's field names *and* expected values as hints (value-guided, per `ARCHITECTURE.md` "Extraction is value-guided, not blind"); returns per-field `foundText`, fuzzy-field status+explanation, and warning bold+confidence signal
   - Estimated effort: Medium
   - Note: reused `ApplicationData` directly as the `hints` parameter type (its keys are the field names, its values the expected values) and `MatchStatus` from `lib/types.ts`, rather than redefining an overlapping hint/status type. `LabelFields` mirrors `ApplicationData`'s pattern (named strict keys + open index signature) since the field set is open, not fixed.
2. [x] **`lib/extraction/geminiExtractor.ts` — default adapter**
   - File(s): `LabelVerificationApp/lib/extraction/geminiExtractor.ts`
   - Details: one structured-output Gemini call per label, per `ARCHITECTURE.md`'s "Extraction is behind a swappable interface" section; API key via environment variable (Golden Principle #2 — never hardcode secrets, throw if unset). Model: `gemini-3.1-flash-lite`, validated in Phase 0 (1.7-2.2s latency, correct structured output) — re-confirm it's still available/current before wiring it in, model IDs already shifted once during planning
   - Estimated effort: Medium
   - Note: implemented via direct REST `fetch` against `generateContent` (`x-goog-api-key` header, `generationConfig.responseMimeType: "application/json"`) — no `@google/genai` SDK dependency added, a single fetch call didn't justify one. Added `LabelVerificationApp/.env.local.example` documenting `GEMINI_API_KEY`; `.gitignore`'s existing `.env*` pattern was also silently excluding that example file from git, so added a `!.env.local.example` negation.

**Validation**:
- [x] Manual call against a real image returns a well-formed `LabelFields` object — confirmed 2026-07-09: 1667ms latency, correct shape (strict fields `alcoholContent`/`netContents` carry only `foundText`; fuzzy fields carry `status`+`explanation`; `warningText` carries `isWarningBold`+`boldConfident`). Regenerated the same synthetic test label as Phase 0's spike, ran a throwaway script (deleted after use, never committed) importing the real `geminiExtractor.ts` directly, using the user's own `GEMINI_API_KEY` in `.env.local`
- [x] Confirm `GEMINI_API_KEY` (or equivalent) is read from `process.env` only, with a thrown error if unset — verified by direct invocation of `geminiExtractor.extract()` with `GEMINI_API_KEY` deleted from the environment; threw before any network call was made
- [x] Code commented per the "💬 Code Commenting Standard" — functions and non-trivial blocks in `types.ts`/`geminiExtractor.ts` explain what they do, not just why

**✅ Post-implementation architecture revision (2026-07-10) — complete, including live-call re-validation:**
Per `ARCHITECTURE.md`'s revised "Matching" section, Alcohol Content and Net Contents move from strict/algorithmic to model-judged; Government Warning is unaffected. This phase's shipped code (`types.ts`, `geminiExtractor.ts`) still reflected the *original* split and needed two changes before Phase 3's dispatcher can be updated to match:
- [x] `lib/extraction/types.ts`: `LabelFields.alcoholContent` and `LabelFields.netContents` need to carry `status`+`explanation` like a fuzzy field does, not just `foundText` (`ExtractedFieldBase`) — either reuse `ExtractedFuzzyField` for them directly, or a new type with the same shape. `warningText` keeps its current `ExtractedWarningField` shape unchanged (Government Warning stays algorithmic). *Done: both fields retyped to `ExtractedFuzzyField`; doc comments on `ExtractedFieldBase`, `ExtractedFuzzyField`, and `LabelFields` updated to explain the new reasoning.*
- [x] `lib/extraction/geminiExtractor.ts`'s prompt: add explicit instructions for `alcoholContent` and `netContents` that judgment must require **exact** numeric equality (no rounding/"close enough"), and for `netContents` specifically: same-system metric conversion is acceptable (`750 mL` = `0.75 L`) but cross-system conversion (metric ↔ imperial, e.g. mL to fl oz) must never be treated as equal. *Done: `STRICT_TRANSCRIPTION_ONLY_FIELDS` removed, both fields now flow through the fuzzy-shape branch; prompt's shape enumeration reduced to two shapes (warningText, everything else) with the exact-equality/conversion carve-out spelled out for these two fields specifically. `tsc --noEmit` and `eslint .` both clean on these two files.*
- [x] Re-run live-call validation after these changes to confirm the new prompt actually produces well-formed `status`+`explanation` for these two fields — **done 2026-07-10**, using the user's own `GEMINI_API_KEY`. Four scenarios run against one synthetic test label (45% Alc./Vol. (90 Proof), 750 mL), varying only the application hints, specifically to exercise the new judgment rules rather than just structural correctness:
  - Exact match (hints identical to label) → both `alcoholContent` and `netContents` `matched`.
  - `alcoholContent` hint off by 1% (44% vs label's 45%) → `mismatched`, explanation: "does not exactly match" — confirms no rounding tolerance.
  - `netContents` hint in same-system metric units (0.75 L vs label's 750 mL) → `matched`, explanation: "750 mL is exactly equal to 0.75 L in the metric system" — confirms same-system conversion is honored.
  - `netContents` hint in cross-system units (25.4 fl oz vs label's 750 mL) → `mismatched`, explanation: "conversion between measurement systems is not permitted" — confirms cross-system conversion is correctly refused, not silently passed.

  The model's own stated reasoning echoes the specific instructions given in the prompt, not just structural compliance. This closes out the last open item from the 2026-07-10 matching architecture revision.

**Confirmed side effect on Phase 3 (not fixed here — Phase 3's own revision below covers it)**: this type change makes `tsc --noEmit` fail with 6 errors in `lib/matching/verify.test.ts` (fixture literals for `alcoholContent`/`netContents` no longer satisfy `ExtractedFuzzyField`), and makes `fieldMatchers.test.ts`'s "routes alcoholContent to the algorithmic numeric matcher" test semantically stale (still compiles and passes at runtime, since it types its literal directly as `ExtractedFieldBase` rather than through `LabelFields`, but asserts dispatch behavior the revision says should no longer happen).

---

### Phase 3: Matching Layer

**Goal**: The three algorithmic matchers, the dispatcher, and the orchestrator — exactly as scoped in `ARCHITECTURE.md`'s "Matching" key decision *as it stood at implementation time*. See the "Post-implementation architecture revision" note at the end of this phase for how that decision changed afterward (Alcohol Content/Net Contents moved to model-judged) and what's still pending in code as a result.

**Tasks**:
1. [x] **`lib/matching/exactMatch.ts` — Government Warning**
   - File(s): `LabelVerificationApp/lib/matching/exactMatch.ts`, `exactMatch.test.ts`
   - Details: case-insensitive word-for-word body match; hard ALL CAPS check on "GOVERNMENT WARNING:" prefix; best-effort bold check. Per this session's correction to `ARCHITECTURE.md`: when the bold-confidence check alone produces `needs_review`, attach a **fixed, code-owned** `explanation` string (e.g. "bold styling could not be confirmed") — do not leave `explanation` empty just because `applicationValue`/`extractedValue` text is identical. Write the Vitest test first (or alongside): a title-cased "Government Warning" prefix must `mismatch` on the ALL CAPS check; a not-confidently-bold-but-textually-correct case must `needs_review` with the fixed explanation string set
   - Estimated effort: Medium
2. [x] **`lib/matching/numericMatch.ts` — Alcohol Content**
   - File(s): `LabelVerificationApp/lib/matching/numericMatch.ts`, `numericMatch.test.ts`
   - Details: parse % from both sides, exact numeric equality, no rounding/tolerance (`CLAUDE.md` non-negotiable constraint). Vitest cases straight from `ARCHITECTURE.md`'s own examples: `45% Alc./Vol.` vs `45% Alc./Vol. (90 Proof)` → `matched`; `44.9%` vs `45%` → `mismatched`
   - **Post-implementation refinement (2026-07-10)**: also parses and compares a proof number when *both* sides state one (same zero-tolerance rule) — `(90 Proof)` vs `(91 Proof)` is a mismatch even if the percentage alone matches, since a proof-only typo would otherwise slip through undetected. Proof stated on only one side (or neither) isn't required to match anything. Reflected in `ARCHITECTURE.md`'s "Matching" section. Two more Vitest cases added; suite now 18 tests total.
   - Estimated effort: Small
3. [x] **`lib/matching/unitMatch.ts` — Net Contents**
   - File(s): `LabelVerificationApp/lib/matching/unitMatch.ts`, `unitMatch.test.ts`
   - Details: parse value + unit separately, whitespace-insensitive, unit spelling normalized, no cross-unit conversion (`CLAUDE.md` non-negotiable constraint) — `750 mL` vs `750 L` must be `mismatched`. Vitest cases: `750 mL` vs `750 mL` → `matched`; `750 mL` vs `750 L` → `mismatched` (no conversion, per `ARCHITECTURE.md`'s own example)
   - Estimated effort: Small
4. [x] **`lib/matching/fieldMatchers.ts` — dispatcher**
   - File(s): `LabelVerificationApp/lib/matching/fieldMatchers.ts`, `fieldMatchers.test.ts`
   - Details: dispatch by field name to the three matchers above; every other field (known-fuzzy or unrecognized — open set, not hardcoded, per `CLAUDE.md`) passes through unchanged, since its status/explanation already came back from the extraction call. Vitest case: an unrecognized field name is not silently dropped — passes through unchanged, same as a known-fuzzy field
   - Estimated effort: Small
5. [x] **`lib/matching/verify.ts` — orchestrator**
   - File(s): `LabelVerificationApp/lib/matching/verify.ts`, `verify.test.ts`
   - Details: build extraction hints from `ApplicationData` → call extractor → algorithmic-match the three strict fields → pass through model judgment for everything else → assemble `FieldResult[]` + rollup `overallStatus` (precedence: any `mismatched` → `mismatched`; else any `needs_review` → `needs_review`; else `matched`). Vitest cases built from `ARCHITECTURE.md`'s row-1042/1043/1044 CSV example fixtures: a strict-field mismatch alone rolls up to `mismatched` (not `needs_review`); a fuzzy-field `needs_review` with everything else matched rolls up to `needs_review`; all-matched rolls up to `matched`
   - Estimated effort: Medium
   - Note: `assembleVerificationResult()` was split out as its own exported synchronous function (fields + rollup only, no `extract()` call) so the matching/rollup logic is directly testable without any mocking; `verify()` itself just calls `extractor.extract()` then delegates to it. Vitest (not yet a project dependency) was added as a devDependency, plus a `test` script (`vitest run`) in `package.json` — this is the first phase needing a test runner.

**Validation**:
- [x] Vitest suite passes for all five files above (`npm run test` or equivalent), covering the fixture cases listed in each task — `npx vitest run`: 5 files, 18 tests, all passed (13 at initial implementation + 1 proof-direction case + 2 proof-typo cases, added 2026-07-10)
- [x] Confirm no model-judged status ever overrides Government Warning, Alcohol Content, or Net Contents (`CLAUDE.md` non-negotiable constraint) — enforced by the `verify.test.ts` rollup cases, not just manual inspection *(superseded for two of the three fields — see the revision note below)*
- [x] Confirm no rounding tolerance and no unit conversion exist anywhere in `numericMatch.ts`/`unitMatch.ts` — enforced by their Vitest cases above *(these two matchers become dormant per the revision below, but stay correct/tested code — not deleted)*
- [x] Code commented per the "💬 Code Commenting Standard" — all five matcher/dispatcher/orchestrator files explain what their functions and non-trivial blocks do

**⚠️ Post-implementation architecture revision (2026-07-10) — code changes applied 2026-07-10:**
Per `ARCHITECTURE.md`'s revised "Matching" section: Government Warning stays exactly as built (`exactMatch.ts` unchanged, still dispatched to). Alcohol Content and Net Contents move to model-judged — now that Phase 2's revision landed (`LabelFields` carries `status`+`explanation` for these two fields), this phase's side:
- [x] `lib/matching/fieldMatchers.ts`: stopped dispatching `alcoholContent` → `numericMatch.ts` and `netContents` → `unitMatch.ts`. These two fields now pass through unchanged, the same code path already used for fuzzy/unrecognized fields — only `warningText` still dispatches to an algorithmic matcher. *Done: `ALCOHOL_CONTENT_FIELD`/`NET_CONTENTS_FIELD` constants and their dispatch branches removed, along with the now-unused `matchAlcoholContent`/`matchNetContents` imports; doc comments at the top of the file and on `matchField()` rewritten to state the new rule and why.*
- [x] `numericMatch.ts` and `unitMatch.ts` stay in the codebase, unused — not deleted. They're the re-enablement path if algorithmic precision gets added back post-deployment; their existing Vitest coverage stays valid (confirmed still passing), it just isn't exercised by the live dispatch path in the meantime.
- [x] `fieldMatchers.test.ts`/`verify.test.ts` fixtures updated for the new dispatcher behavior. *Done: `fieldMatchers.test.ts`'s stale "routes alcoholContent to the algorithmic numeric matcher" test (which only compiled because it typed its fixture as `ExtractedFieldBase` rather than the real `LabelFields` shape) replaced with two tests — one for `alcoholContent`, one for `netContents` — each using a `LabelFields`-shaped `ExtractedFuzzyField` fixture and asserting pass-through (returned `FieldResult` matches the fixture's `status`/`explanation` exactly, not something recomputed). `verify.test.ts`'s three rollup-precedence fixtures updated: `alcoholContent`/`netContents` fixtures now set `status`+`explanation` directly (no more algorithmic decision happening inside `verify.ts` to produce it); the "strict-field mismatch alone rolls up to mismatched" scenario was moved onto `warningText` specifically (via a non-ALL-CAPS prefix transcription) since `warningText` is now the only field left whose match decision is made by real matcher code end-to-end through the orchestrator — using a pre-set `alcoholContent`/`netContents` status there would only re-prove `rollupStatus()`'s own field-agnostic precedence, already covered by the other two scenarios.*
- [x] Phase Validation checklist above updated (see the two rephrased bullets, each now marked with a *(superseded...)* parenthetical) — "no model-judged status overrides Alcohol Content/Net Contents" no longer holds true by design; the parenthetical explains the new state rather than leaving the original claim looking current.

**Validation evidence (2026-07-10)**: `npx tsc --noEmit` — clean, 0 errors (the 6 errors from Phase 2's type-only revision are resolved). `npx eslint .` — clean, 0 problems. `npx vitest run` — 5 test files, 19 tests, all passed (18 before this revision + 1 net new, from splitting the old single alcoholContent-dispatch test into two — one per field — in `fieldMatchers.test.ts`). Left as uncommitted working-tree changes on `develop`, alongside Phase 2's revision and the earlier proof-typo refinement to `numericMatch.ts`, for the user to review and commit themselves.

---

### Phase 4: Single-Verify API + UI (demoable milestone)

**Goal**: End-to-end single-label verification working in the browser — the first fully demoable slice.

**Tasks**:
1. [x] **`app/api/verify/route.ts`**
   - File(s): `LabelVerificationApp/app/api/verify/route.ts`
   - Details: `POST` — one image + one application JSON in, one `VerificationResult` out; fully stateless (nothing persisted); set `maxDuration` explicitly per `ARCHITECTURE.md`'s "Latency budget" (value informed by Phase 0 spike results)
   - Estimated effort: Medium
   - Note: request is `multipart/form-data` (an `image` File part + an `applicationData` JSON-string part), not a single JSON body with a base64 image field — lets the browser hand off the raw `File` object directly; the one base64 conversion happens server-side, once, right before calling `verify()`. Validates both parts (missing/wrong-typed image, missing/invalid-JSON/wrong-shaped `applicationData`) before calling `verify()` from `lib/matching/verify.ts` unchanged — no extraction/matching logic duplicated in the route. `maxDuration = 8`.
2. [x] **`components/UploadForm.tsx`**
   - File(s): `LabelVerificationApp/components/UploadForm.tsx`, `LabelVerificationApp/components/UploadForm.module.css`
   - Details: single-label image + application-data input; client-side abort (~10s, after `maxDuration`) per `ARCHITECTURE.md`; timeout surfaces as the same error-badge-with-retry state as any other failed verification
   - Estimated effort: Medium
   - Note: static form for the 7 common fields from `REQUIREMENTS.md`'s sample label (brand name, class/type, alcohol content, net contents, producer, country of origin, government warning text), not a dynamic arbitrary-field-adder — `KNOWN_FIELDS` is exported and reused by `ResultsTable.tsx` so a field's label reads identically in the form and the results. `CLIENT_ABORT_MS = 10_000`, deliberately after the route's 8s `maxDuration`. A timeout (`AbortError`) and any server-returned error both land in the same `errorMessage` state + Retry button, per the plan.
3. [x] **`components/ResultsTable.tsx`**
   - File(s): `LabelVerificationApp/components/ResultsTable.tsx`, `LabelVerificationApp/components/ResultsTable.module.css`
   - Details: status badges (Matched/Mismatched/Needs Review), expandable per-row field comparison including the model's explanation text for fuzzy-field judgments; show elapsed verification time (e.g. "Verified in 2.3s") per `ARCHITECTURE.md`
   - Estimated effort: Medium
   - Note: expandable rows use native `<details>`/`<summary>` (keyboard support + ARIA semantics for free, no hand-rolled toggle). Shows `explanation` for any field that has one — fuzzy fields, Alcohol Content/Net Contents (model-judged as of the 2026-07-10 revision), and Government Warning's fixed bold-uncertainty string all covered, since all pass through the same `FieldResult.explanation` field. Unknown field names fall back to a camelCase-splitting humanizer rather than being hardcoded.
4. [x] **`app/page.tsx` — main UI (single-verify portion)**
   - File(s): `LabelVerificationApp/app/page.tsx`, `LabelVerificationApp/app/page.module.css`
   - Details: wires `UploadForm` + `ResultsTable`; usability bar is a first-time, low-tech-comfort user (`REQUIREMENTS.md`'s 73-year-old benchmark) — clean, obvious, no hunting for buttons
   - Estimated effort: Medium
   - Note: replaced the `create-next-app` boilerplate entirely; single linear flow (intro text → form → result), no batch placeholder UI added (out of scope for this phase). Plain CSS Modules (already the scaffold's convention via `page.module.css`), no component library pulled in.

**Validation**:
- [x] End-to-end manual demo: upload one label image + application data, get a result back in ~5s, with correct status/explanation display — **done 2026-07-10**, real `POST /api/verify` call against the running dev server (not just the extractor in isolation): HTTP 200 in 1621ms, well under the ~5s target. `brandName`/`classType`/`producer`/`alcoholContent`/`netContents` all came back `matched` with model explanations (the latter two confirming the 2026-07-10 model-judged revision works through the full route, not just `geminiExtractor.ts` directly). `warningText` correctly came back `mismatched` with no explanation — the test's application data omitted the "GOVERNMENT WARNING:" prefix, so `exactMatch.ts`'s "prefix absent from either side → unambiguous mismatch" branch fired exactly as designed, confirming Government Warning is genuinely still algorithmic end-to-end. `npx tsc --noEmit` clean, `npx eslint .` clean, `npm run build` succeeds.
- [x] Confirm zero server-side trace remains after the response is sent (no accidental persistence introduced) — confirmed by inspection: `route.ts` calls only `request.formData()` and `verify()`, no writes to disk/KV/Blob/any store anywhere in the request path.
- [x] This is the checkpoint to pause and confirm the demoable-core bar is met before starting batch work — **met**: single-verify works end-to-end through the real route, real UI, and the real Gemini API, with correct behavior across every field category (fuzzy, model-judged-strict, algorithmic-strict).
- [x] Code commented per the "💬 Code Commenting Standard" — all four files (plus their CSS modules, which are plain style sheets, not logic) carry file-level purpose comments and per-function/non-trivial-block comments matching the thoroughness of `verify.ts`/`geminiExtractor.ts`.

---

### Phase 5: Batch Input Parsing ✅

**Goal**: Swappable `BatchInputParser` interface + CSV default implementation, decoupled from UI/concurrency logic per `NOTES.md`'s "Batch input parsing should be decoupled" (now reflected into `ARCHITECTURE.md`).

**Tasks**:
1. [x] **`lib/batchInput/types.ts`**
   - File(s): `LabelVerificationApp/lib/batchInput/types.ts`
   - Details: `BatchInputParser.parse(csvText, imageFiles) → { entries: BatchEntry[], errors: PairingError[] }`; `BatchEntry = { fileName, image, applicationData }`; `PairingError = { fileName, reason: "no_matching_image" | "no_matching_row" }`
   - Estimated effort: Small
2. [x] **`lib/batchInput/csvManifestParser.ts`**
   - File(s): `LabelVerificationApp/lib/batchInput/csvManifestParser.ts`, `csvManifestParser.test.ts`
   - Details: CSV text + image file list → `BatchEntry[]` + `PairingError[]`; pairing by dedicated `fileName` column (separate from `id`, per `ARCHITECTURE.md`'s "Batch upload UI" key decision). Vitest cases: a small CSV + matching/mismatching image filenames produces the correct `entries`/`errors` split, covering both `no_matching_image` and `no_matching_row`
   - Estimated effort: Medium
   - Note: `id` and `fileName` are both treated as reserved/bookkeeping columns and excluded from the built `ApplicationData` (every other manifest column becomes an open field, named exactly as its header, matching `ApplicationData`'s own open field set — never a hardcoded list). A blank cell is treated as "field absent from this application" (omitted from the object entirely), not an empty string to match literally, consistent with `ARCHITECTURE.md`'s "a field absent from the application isn't checked on the label." CSV tokenizing is a hand-written RFC4180-style single-pass scanner (quoted fields, embedded commas/newlines, doubled-quote escaping, CRLF/LF both accepted) rather than a naive `split(",")` — no new dependency added, and the parser is pure/synchronous so it can run client-side during preflight with no round-trip. A manifest with no `fileName` column at all throws (a malformed-manifest condition, not a per-row `PairingError`); an empty manifest returns empty `entries`/`errors`. 9 Vitest cases added, covering the happy path, both `PairingError` reasons together and separately, blank-cell-as-absent, a quoted field with an embedded comma, an unrecognized column passing through as an open field, the missing-`fileName`-column throw, and the empty-manifest case.

**Validation**:
- [x] Vitest suite passes for `csvManifestParser.test.ts`, covering both `no_matching_image` and `no_matching_row` cases — `npx vitest run`: 6 files, 28 tests, all passed (19 before this phase + 9 new)
- [x] Code commented per the "💬 Code Commenting Standard" — `types.ts`/`csvManifestParser.ts` explain what they do, not just why

---

### Phase 6: Batch Persistence Layer ✅

**Goal**: The minimal, ephemeral, TTL'd server-side store — cookie, KV, Blob, single-tab lock — per `ARCHITECTURE.md`'s "Single-verify stays stateless; batch gets a minimal, ephemeral server-side store."

**Tasks**:
1. [x] **`lib/persistence/cookie.ts`**
   - File(s): `LabelVerificationApp/lib/persistence/cookie.ts`, `cookie.test.ts`
   - Details: anonymous batch-owner id — read existing or issue new; opaque UUID, no login, no PII (`CLAUDE.md` non-negotiable: no accounts/auth)
   - Estimated effort: Small
   - Note: framework-agnostic — operates on raw `Cookie`/`Set-Cookie` header strings, not `NextRequest`/`NextResponse`, so it's directly unit-testable and stays swappable if the hosting framework changes. `readOrIssueOwnerId()` reuses an existing id or issues a fresh `crypto.randomUUID()`; `buildOwnerCookieHeader()` sets `HttpOnly`/`Secure`/`SameSite=Lax`/`Path=/`/`Max-Age` (~48h, matching the KV TTL). 7 Vitest cases.
2. [x] **`lib/persistence/kvStore.ts`**
   - File(s): `LabelVerificationApp/lib/persistence/kvStore.ts`, `kvStore.test.ts`
   - Details: `BatchRecord`/`BatchRowState` read/write per `ARCHITECTURE.md`'s Data Model, ~48h TTL
   - Estimated effort: Medium
   - Note: real `@vercel/kv` usage (added as a dependency this phase). `BatchRecord` gained two fields beyond `ARCHITECTURE.md`'s listed set — `lockedByTabId?`/`lockHeartbeatAt?` — needed to actually implement the heartbeat `batchLock.ts` renews, documented in the type's own doc comment as owned by `batchLock.ts`'s decision logic, just stored here. Every `kv.set` call passes `{ ex: BATCH_TTL_SECONDS }` (~48h) — no unTTL'd write path exists. Key-naming functions (`batchRecordKey`/`batchRowKey`/`ownerCurrentBatchKey`) are pure and exported; the actual `kv.get`/`kv.set`/`kv.mget` wrapper functions are not unit-tested, per this project's established convention (pure logic gets tests, direct external API calls don't — same as `geminiExtractor.ts`). 5 Vitest cases on the key-naming logic.
3. [x] **`lib/persistence/blobUpload.ts`**
   - File(s): `LabelVerificationApp/lib/persistence/blobUpload.ts`, `blobUpload.test.ts`
   - Details: client-upload helper (signed-URL, direct browser-to-Blob) — not routed through an API body, per `ARCHITECTURE.md`'s Vercel body-size-limit rationale
   - Estimated effort: Medium
   - Note: real `@vercel/blob`/`@vercel/blob/client` usage (added as a dependency this phase). `uploadLabelImage()` (browser-side, calls `upload()`) and `handleLabelImageUploadRequest()` (server-side, wraps `handleUpload()`, restricts the token to the `batches/` pathname namespace and image content types) both live here per `ARCHITECTURE.md`'s Directory Structure (one `blobUpload.ts` file). **Forward dependency for Phase 7**: `ARCHITECTURE.md`'s three listed batch routes don't include a dedicated blob-token endpoint — Phase 7 needs to add a Route Handler (path documented as `LABEL_IMAGE_UPLOAD_HANDLER_PATH = "/api/batch/blob-upload"`, exported from this file) that calls `handleLabelImageUploadRequest()`, or fold the handshake into an existing batch route. Only `blobPathForLabelImage()` (pure pathname logic) is unit-tested — 2 Vitest cases; the two functions that call `@vercel/blob` are not, per the same testing-scope convention as `kvStore.ts`.
4. [x] **`lib/persistence/batchLock.ts`**
   - File(s): `LabelVerificationApp/lib/persistence/batchLock.ts`, `batchLock.test.ts`
   - Details: `sessionStorage`-held tab id claims the batch, renews a heartbeat on the KV record; a second tab sees the lock held and is blocked/warned
   - Estimated effort: Medium
   - Note: `evaluateLockClaim()` is factored out as a pure decision function (free lock / already-ours / stale-and-stealable / held-and-fresh) and is the only part covered by Vitest (7 cases, including the exact stale-boundary case and a custom-threshold override) — `getOrCreateTabId()` (`sessionStorage`) and `claimBatchLock()`/`releaseBatchLock()` (real KV reads/writes via `kvStore.ts`) are not, per the same testing-scope convention. This is a best-effort, read-then-write application-level lock, not an atomic compare-and-swap — documented in the file header as a deliberate, proportionate trade-off (protecting against a UX footgun, not building a distributed-systems guarantee), with the heartbeat-staleness check as the mechanism that recovers from an abandoned lock (crashed/closed tab) rather than blocking a batch forever.

**Validation**:
- [x] Confirm TTL is set on all KV writes (no durable/indefinite storage — `CLAUDE.md` non-negotiable, batch-store exception only) — confirmed by inspection: every `kv.set` call in `kvStore.ts` passes `{ ex: BATCH_TTL_SECONDS }`, no write path omits it
- [x] Confirm cookie contains no PII, no login/password mechanism anywhere in this layer — confirmed: `cookie.ts` issues an opaque `crypto.randomUUID()` with no user-supplied or identifying data; no password/login code anywhere in this phase's four files
- [x] Code commented per the "💬 Code Commenting Standard" — all four persistence files explain what their functions do, not just why

**Validation evidence (2026-07-11)**: `npx tsc --noEmit` — clean, 0 errors. `npx eslint .` — clean, 0 problems. `npx vitest run` — 10 test files, 50 tests, all passed (28 before this phase + 22 new: 7 in `cookie.test.ts`, 5 in `kvStore.test.ts`, 2 in `blobUpload.test.ts`, 7 in `batchLock.test.ts`). `npm run build` also succeeds (bonus check, not part of this phase's required validation — confirms the two new dependencies bundle cleanly even though nothing calls them from a route yet). `@vercel/kv` and `@vercel/blob` added as dependencies (`package.json`/`package-lock.json`). `.env.local.example` documents the two new required env var pairs (`KV_REST_API_URL`/`KV_REST_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`) following the existing `GEMINI_API_KEY` pattern — no live KV/Blob credentials were available in this session, so nothing in this phase was tested against a real KV/Blob store; that's expected per this phase's stated scope, not a gap. Left as uncommitted working-tree changes on `batch-input`, for the user to review and commit themselves.

---

### Phase 7: Batch API Routes ✅

**Goal**: Server-driven, chunked batch processing endpoints.

**Tasks**:
1. [x] **`app/api/batch/route.ts`**
   - File(s): `LabelVerificationApp/app/api/batch/route.ts`
   - Details: `POST` — register a new batch (Blob refs + parsed CSV rows), sets the anonymous cookie if none exists
   - Estimated effort: Medium
   - Note: request body is `{ rows: [{ fileName, applicationData, blobRef }] }` — pairing and image upload both already happened client-side (Phase 8), so this route's own job is pure request-validation-then-KV-write plumbing. `BatchRecord` is written with one extra field beyond its declared type, `rowFileNames: string[]` — needed so `/process` and `/current` can enumerate a batch's rows from a single lookup, since `BatchRecord` itself only carries a count, not the list. Declared as a locally-scoped type extension (`BatchRecord & { rowFileNames: string[] }`) in each of the three routes that need it, rather than widening `kvStore.ts`'s own type, to stay inside this phase's file scope. `isApplicationData`/`validateRegisterBatchRow` exported for direct unit testing.
2. [x] **`app/api/batch/[id]/process/route.ts`**
   - File(s): `LabelVerificationApp/app/api/batch/[id]/process/route.ts`
   - Details: `POST` — process up to `N` pending rows in parallel (`Promise.all`), writes results to KV, returns updated progress. **`N` resolved to `1`** per Phase 0's real rate-limit findings (15 RPM on `gemini-3.1-flash-lite` leaves no real parallelism headroom — see "✅ Gemini Model, Latency & Concurrency" above). Still wire it as a config value (env var), not a bare literal `1` in the code — this is what lets `N` scale up later on a paid tier without a rebuild, and is the actual reason the `Promise.all` structure exists even though it only awaits one call at a time right now
   - Estimated effort: Large
   - Note: uses `Promise.allSettled`, not bare `Promise.all` — identical concurrency characteristics (every row starts together, waits overlap), but one row's extraction failure can't discard every other row's result in the same round. A failing row is left `in_flight` in KV (written before the failing call, per the idempotent-redo design) and reported in a `rowErrors` list rather than failing the whole HTTP response. This route also owns claiming/renewing the single-active-tab lock (`claimBatchLock()` from the already-built lock module) on every call, keyed by a `tabId` the request body carries — the cleanest place for this given the lock's read/write calls need server-side KV credentials a browser bundle can't hold directly. `resolveBatchProcessConcurrency()` (env var, defaulting to 1) and `summarizeBatchProgress()` (pure progress-shaping) exported for direct unit testing. `fetchLabelImage()` mirrors `app/api/verify/route.ts`'s File-to-base64 conversion, adapted to start from a `fetch()` of the row's Blob URL instead of a directly-uploaded File.
3. [x] **`app/api/batch/current/route.ts`**
   - File(s): `LabelVerificationApp/app/api/batch/current/route.ts`
   - Details: `GET` — reads the cookie, reports an unfinished batch if one exists in KV, for the resume-prompt flow
   - Estimated effort: Small
   - Note: a brand-new (just-issued) owner id short-circuits to `{ batch: null }` without setting a cookie — a fresh id can't have a batch registered under it yet, and this route shouldn't hand out a cookie to a browser that hasn't started anything (only real batch registration does that). Returns every row's state, not just counts, so a resuming browser can both re-hydrate already-`done` results and keep processing whatever's still `pending`/`in_flight` without re-deriving anything from the original CSV. `buildCurrentBatchSummary()` exported for direct unit testing.
4. [x] **`app/api/batch/blob-upload/route.ts`** (added 2026-07-11 — Phase 6 built the handler logic but flagged that no route file wires it up)
   - File(s): `LabelVerificationApp/app/api/batch/blob-upload/route.ts`
   - Details: `POST` — thin Route Handler wiring for `lib/persistence/blobUpload.ts`'s `handleLabelImageUploadRequest()`, the same thin-delegation pattern `app/api/verify/route.ts` uses around `verify()`. This is the server-side half of the client-upload token handshake `uploadLabelImage()` (also in `blobUpload.ts`) depends on — without this route, `LABEL_IMAGE_UPLOAD_HANDLER_PATH` (`/api/batch/blob-upload`) points at a URL that doesn't exist yet, and any client-side upload call would 404
   - Estimated effort: Small
   - Note: typed against the plain `Request` type (not `NextRequest`) since nothing here needs anything Next-specific, matching `handleLabelImageUploadRequest()`'s own signature exactly and making the handler directly callable from a test with a plain `new Request(...)`.

**Validation**:
- [x] Confirm re-processing an `in_flight`-at-crash-time row is safe (no side effects beyond writing its own result) per the resume design's own rationale — confirmed by inspection: `/process` treats `in_flight` rows identically to `pending` ones when picking work, and `verify()`'s only side effect is the `FieldResult`/`VerificationResult` it returns, overwritten idempotently on every attempt
- [x] Confirm `N` is read from config (defaulting to `1`), not hardcoded inline — `resolveBatchProcessConcurrency()` reads `BATCH_PROCESS_CONCURRENCY`, falling back to `1` only when unset or not a usable positive number; covered by 5 Vitest cases
- [ ] Confirm batch progress UI discloses the ~20-minute completion time for a full 200-300 label batch at N=1 — deferred to Phase 8 (no progress UI exists yet; this route's own response already carries `doneCount`/`pendingCount`/`isComplete` for that UI to read)
- [x] Confirm `POST /api/batch/blob-upload` actually resolves (not a 404) and correctly rejects a token request for a pathname outside the `batches/` namespace — confirmed two ways: `next build` lists `/api/batch/blob-upload` as a real resolved route, and a Vitest test calls the real (unmocked) `handleLabelImageUploadRequest()` through this route with an out-of-namespace pathname and confirms a 400 naming the `batches/` namespace; a second test confirms an in-namespace pathname succeeds and returns a real signed client token — both run fully offline (token generation is local HMAC signing, no network call, confirmed by reading `@vercel/blob`'s own source before relying on it)
- [x] Code commented per the "💬 Code Commenting Standard" — all four batch API routes explain what they do, not just why

**Validation evidence (2026-07-11)**: `npx tsc --noEmit` — clean, 0 errors. `npx eslint .` — clean, 0 problems. `npx vitest run` — 14 test files, 76 tests, all passed (50 before this phase + 26 new: 11 in `app/api/batch/route.test.ts`, 9 in `app/api/batch/[id]/process/route.test.ts`, 3 in `app/api/batch/current/route.test.ts`, 3 in `app/api/batch/blob-upload/route.test.ts`). `npm run build` also succeeds, listing all four batch routes as resolved dynamic routes. A `vitest.config.ts` was added (previously absent) so Vitest can resolve the `@/...` path alias this phase's route files use internally — every earlier test file only ever imported its subject via a relative path, so this gap was never hit before Phase 7. No live Vercel KV/Blob credentials were available this session, so the actual KV-reading/writing/Blob-fetching code paths inside these four routes are validated by inspection and by `next build`'s successful route resolution, not by a live end-to-end call — consistent with this project's established testing-scope convention (pure logic gets Vitest coverage, direct external API calls don't), extended here to cover request/response shaping and config parsing that lives inside the route files themselves. Left as uncommitted working-tree changes on `batch-input`, for the user to review and commit themselves. Only this phase's four route files, their four new test files, and the new `vitest.config.ts` were touched — `lib/persistence/*`, `lib/batchInput/*`, `components/UploadForm.tsx`, and every other already-committed file were left untouched.

---

### Phase 8: Batch UI + Client-Side Orchestration ✅

**Goal**: Two-zone upload with preflight confirm, chunked-processing loop, resume prompt, single-tab lock enforcement — the second demoable milestone.

**Tasks**:
1. [x] **`components/BatchUploadPanel.tsx`**
   - File(s): `LabelVerificationApp/components/BatchUploadPanel.tsx`
   - Details: two labeled zones (CSV manifest zone with "Download CSV template" link; label-images zone, plain multi-file picker, not `webkitdirectory`); after both provided, run `BatchInputParser` client-side and show a preflight pairing summary (e.g. "298/300 matched; 2 rows have no image") requiring explicit "Proceed with N matched" confirmation before anything uploads
   - Estimated effort: Large
   - Note: preflight is a `useMemo` over the CSV text + selected image files (not a separate button/effect) — the summary and its "Proceed with N matched" button simply appear once both are provided, computed via the already-built `csvManifestParser`. Pairing errors are listed individually (not just counted), split by direction (`no_matching_image` vs `no_matching_row`) via an exported, directly-tested `buildPreflightSummary()`. The CSV template button reuses `UploadForm.tsx`'s own `KNOWN_FIELDS` list (keys + placeholders) as its single source of truth rather than a second, parallel field list, generated client-side as a downloaded Blob.
2. [x] **Chunked-processing / resume / lock client logic**
   - File(s): `LabelVerificationApp/components/BatchUploadPanel.tsx` (co-located, not a separate hook file — kept in one file per this phase's stated scope)
   - Details: uploads images directly to Blob, registers the batch (`POST /api/batch`), then loops `POST /api/batch/[id]/process` while its tab holds the lock (`batchLock.ts`); on load, calls `GET /api/batch/current` and offers resume if an unfinished batch is found
   - Estimated effort: Large
   - Note: **design decision not spelled out in the interfaces themselves** — `uploadLabelImage()` needs a batch id to namespace each image's Blob path *before* any batch is registered, but batch registration (which is what actually assigns the real, server-side batch id) can only happen *after* every image has finished uploading. Resolved by generating a throwaway `crypto.randomUUID()` client-side purely to namespace this one upload pass in Blob storage; it's discarded the instant registration hands back the real batch id, and nothing downstream ever compares the two. The processing loop calls `/process` back-to-back with no artificial delay between calls — each call's own real network-plus-extraction latency already paces successive calls close to the extraction provider's own rate limit, so an added client-side delay would only slow completion further, not add safety. A 409 (another tab holds the lock) and any other failed call both stop the loop outright with a manual "try again" action, rather than retrying in a tight loop; a row-level failure inside an otherwise-successful call does not stop the loop, since the server already leaves that row safely retryable on the very next call. The resume-check (`GET /api/batch/current`) runs in the background against upload zones that are already visible the moment the component mounts, rather than gating the whole setup screen behind a loading state — a found, still-unfinished batch surfaces a dismissible resume banner above the zones; nothing auto-resumes without an explicit click either way.
3. [x] **Wire `BatchUploadPanel` into `app/page.tsx`**
   - File(s): `LabelVerificationApp/app/page.tsx`, `LabelVerificationApp/app/page.module.css`
   - Details: integrate alongside the single-verify UI from Phase 4
   - Estimated effort: Small
   - Note: **design decision** — presented as two always-visible, clearly labeled sections stacked on the page (single-verify first, batch second), not a tab toggle that hides one flow behind a click. A tab toggle was tried first and reverted: it left the batch section entirely absent from the page's initial (prerendered) HTML until a user actually clicked into it, which also meant a static/no-JS view of the page showed only one of the two flows existing at all — two stacked sections keep both genuinely visible up front, consistent with the plan's own "no hunting for anything" usability bar.

**Validation**:
- [ ] Manual test: submit a small batch (5-10 rows), confirm chunked progress updates, refresh mid-batch, confirm resume prompt correctly reports done/pending counts — **not run this session**: needs real `KV_REST_API_URL`/`KV_REST_API_TOKEN`/`BLOB_READ_WRITE_TOKEN`/`GEMINI_API_KEY` credentials, none of which were available. Same gap Phases 6/7 already carried forward for their own KV/Blob-dependent code paths.
- [ ] Manual test: open the same batch in a second tab, confirm the lock blocks/warns rather than racing — **not run this session**, same credential gap; the 409-handling branch (`phase === "lockBlocked"`) is implemented and type-checked but not exercised against a real second-tab race.
- [x] Confirm a deliberately mismatched CSV/image set produces the correct preflight summary and does not silently proceed without confirmation — confirmed via `BatchUploadPanel.test.ts`'s `buildPreflightSummary`/`describePairingError` cases (both `no_matching_image` and `no_matching_row` counted and described correctly) plus code inspection: the "Proceed with N matched" button is the only path into `confirmAndStart()`, is disabled when `matchedCount === 0`, and no upload call exists anywhere else in the component.
- [x] Code commented per the "💬 Code Commenting Standard" — `BatchUploadPanel.tsx` (component, pure helpers, and the chunked-processing/resume/lock logic alike) and `app/page.tsx` explain what they do throughout, not just why; grepped for any outer-repo doc reference (`ARCHITECTURE`/`PLAN_00`/`CLAUDE.md`/`REQUIREMENTS.md`/`NOTES.md`/`.md`) across every file this phase touched — zero matches.

**Validation evidence (2026-07-11)**: `npx tsc --noEmit` — clean, 0 errors. `npx eslint .` — clean, 0 problems. `npx vitest run` — 15 test files, 94 tests, all passed (76 before this phase + 18 new, all in `components/BatchUploadPanel.test.ts`, covering `csvEscape`, `buildCsvTemplate`, `buildPreflightSummary`, `describePairingError`, `formatEstimatedTimeRemaining`, and `applyProcessedRows` — the pure, non-rendering logic this phase's testing-scope convention covers; the component's own network calls, Blob uploads, and `sessionStorage`-backed tab id are not automated, matching how `UploadForm.tsx`'s own submit flow was never unit-tested either). `npm run build` succeeds, listing `/` as still statically prerendered and all four batch routes (unchanged, already built in Phase 7) as resolved dynamic routes. Dev-server smoke test: started `npm run dev`, confirmed `GET /` returns HTTP 200 with both the single-verify form (`Verify Label` button) and every batch upload marker (`Batch Verification` heading, both zone headings, the CSV template download button, both file inputs) present directly in the server-rendered HTML — not just reachable after a client-side click — then stopped the dev server. No live KV/Blob/Gemini credentials were available this session, so the actual chunked-processing loop, Blob uploads, batch registration, and lock-contention handling are validated by inspection and type-checking only, not a real end-to-end batch run — consistent with Phases 6/7's own stated gap for their KV/Blob-dependent code paths. Left as uncommitted working-tree changes on `batch-input`, for the user to review and commit themselves. Only `components/BatchUploadPanel.tsx` (+ new `.module.css`/`.test.ts`), `app/page.tsx`, and `app/page.module.css` were touched — `lib/persistence/*`, `lib/batchInput/*`, `components/UploadForm.tsx`, `components/ResultsTable.tsx`, and every other already-committed file were left untouched.

---

### Phase 9: CSV Export ✅

**Goal**: Downloadable results CSV in the same-shape-plus-`status`-plus-`flaggedFields` format.

**Prerequisite fix applied before this phase's own tasks (2026-07-11)**: threaded the CSV manifest's `id` column all the way through the batch pipeline — it was parsed by `csvManifestParser.ts` but discarded before it ever reached `BatchEntry`, the `POST /api/batch` request body, or `BatchRowState`, even though the results CSV's own worked example (and this phase's own task) requires `id` as the export's first column. `lib/batchInput/types.ts` (`BatchEntry` gains `id: string`), `lib/batchInput/csvManifestParser.ts` (`parse()` now also reads the `id` column, defaulting to `""` when the manifest has no `id` column or the cell is blank — same ragged-CSV tolerance already used for every other column), `components/BatchUploadPanel.tsx` (the registration request body now carries `id: entry.id` per row), `app/api/batch/route.ts` (`RegisterBatchRowInput` gains `id: string`; `validateRegisterBatchRow()` requires it to be a string but not non-empty, unlike `fileName`/`blobRef`), `lib/persistence/kvStore.ts` (`BatchRowState` gains `id: string`) — plus test-fixture updates in `csvManifestParser.test.ts`, `app/api/batch/route.test.ts`, `app/api/batch/[id]/process/route.test.ts`, `app/api/batch/current/route.test.ts`, and `components/BatchUploadPanel.test.ts` for the new required field, and one new test confirming `id` flows from CSV text through `csvManifestParser.parse()`'s returned `BatchEntry.id` (including the no-`id`-column-at-all default-to-`""` case). `app/api/batch/[id]/process/route.ts` and `app/api/batch/current/route.ts` needed no logic changes — both already pass whole `BatchRowState` objects through unchanged.

**Tasks**:
1. [x] **`lib/export/resultsToCsv.ts`**
   - File(s): `LabelVerificationApp/lib/export/resultsToCsv.ts`, `resultsToCsv.test.ts`
   - Details: serializes finished batch rows (`BatchRowState[]`, filtered to `status === "done"`) to CSV, entirely client-side. `id`/`fileName` carried through unchanged, then every distinct application field name observed across all rows' `result.fields` (derived dynamically, first-seen order — never a hardcoded column list), then `status` (rollup) and `flaggedFields` (populated only when `status !== "matched"`, `"; "`-joined). Each flagged entry is `fieldName (label says <extractedValue>)` **except** when the field carries an `explanation` (a fuzzy-field's model reasoning, or the Government Warning's fixed bold-uncertainty message) — those use `fieldName (<explanation>)` instead. A row that never finished (still `pending`/`in_flight`) is silently skipped, not crashed on or padded with blanks. Vitest cases built directly from the design doc's row-1042/1043/1044 worked example: a strict-field mismatch (rolls up to `mismatched`, uses the `(label says ...)` shape), a clean `matched` row (blank `flaggedFields`), and a `needs_review` row combining a fuzzy-field explanation and a bold-uncertain explanation (both use the `(<explanation>)` shape) — plus dynamic-column-derivation, unfinished-row-skipping, and CSV-escaping cases. 7 Vitest cases total.
   - Estimated effort: Medium
   - Note: local `csvEscape()` mirrors `csvManifestParser.ts`'s/`BatchUploadPanel.tsx`'s own minimal-quoting convention (quote only when a comma/quote/newline is present) rather than always-quoting the `flaggedFields` cell — kept as its own small local copy rather than importing a UI component's helper into a `lib` module or adding a shared-utility file for one three-line function.
2. [x] **"Download Results" button in batch view**
   - File(s): `LabelVerificationApp/components/BatchUploadPanel.tsx`
   - Details: wires `resultsToCsv.ts` to a client-side download (`Blob` + `URL.createObjectURL` + temporary `<a download>` click, the same pattern the existing "Download CSV template" button already uses)
   - Estimated effort: Small
   - Note: shown whenever `doneCount > 0`, inside the same always-rendered progress view the processing/paused/complete phases already share — not gated behind full batch completion, since `resultsToCsv()` already tolerates unfinished rows by skipping them, so a mid-batch download is a normal, useful action, not an edge case to hide.

**Validation**:
- [x] Vitest suite passes for `resultsToCsv.test.ts`, covering the row-1042/1043/1044 fixture cases above — `npx vitest run`: 16 files, 105 tests, all passed (98 before this phase's own two tasks + 7 new, on top of 4 new tests from the id-threading prerequisite fix, for 94 → 98 → 105)
- [ ] Manual smoke test: "Download Results" button in the browser produces a file that opens correctly in Excel/Sheets — **not run this session**: no live `KV_REST_API_URL`/`KV_REST_API_TOKEN`/`BLOB_READ_WRITE_TOKEN`/`GEMINI_API_KEY` credentials were available, so no real batch could be registered/processed to click the button against; validated instead by `resultsToCsv.test.ts`'s direct coverage of the CSV text the button hands to the browser's download mechanism, plus code inspection of the download wiring itself (identical, working pattern to the already-shipped "Download CSV template" button)
- [x] Code commented per the "💬 Code Commenting Standard" — `resultsToCsv.ts` explains what it does throughout, not just why; grepped the whole repo for any outer-repo doc reference (`\.md\b|ARCHITECTURE|PLAN_00|CLAUDE\.md|REQUIREMENTS\.md|NOTES\.md`) — zero matches

**Validation evidence (2026-07-11)**: `npx tsc --noEmit` — clean, 0 errors. `npx eslint .` — clean, 0 problems. `npx vitest run` — 16 test files, 105 tests, all passed. `npx next build` — succeeds, all four batch routes plus `/api/verify` resolve as dynamic routes, `/` still prerenders statically. Dev-server smoke test: `GET /` returns HTTP 200 with both the single-verify form (`Verify Label`) and every batch upload marker (`Batch Verification`, `CSV Manifest`, `Label Images`, `Download CSV template`, 3 `type="file"` inputs total — one single-verify, two batch) present directly in the server-rendered HTML; dev server stopped afterward. No live KV/Blob/Gemini credentials were available this session, so the actual button click / real file download in a browser is not exercisable end-to-end — validated by code inspection (identical wiring to the already-shipped, working CSV-template download) plus `resultsToCsv.test.ts`'s full coverage of the pure serialization logic feeding that download, consistent with this project's established testing-scope convention. Left as uncommitted working-tree changes on `batch-input`, for the user to review and commit themselves. Files touched: the prerequisite id-threading fix touched `lib/batchInput/types.ts`, `lib/batchInput/csvManifestParser.ts` (+ its test file), `components/BatchUploadPanel.tsx` (+ its test file), `app/api/batch/route.ts` (+ its test file), `lib/persistence/kvStore.ts`, and the test fixtures in `app/api/batch/[id]/process/route.test.ts`/`app/api/batch/current/route.test.ts` — all already-committed files. This phase's own new work is `lib/export/resultsToCsv.ts` (+ new `resultsToCsv.test.ts`) and the "Download Results" button addition to the already-uncommitted `components/BatchUploadPanel.tsx`.

---

### Phase 10: Deployment, README, Write-up

**Goal**: Deployed working URL + both explicit `REQUIREMENTS.md` documentation deliverables.

**Tasks**:
1. [ ] **Deploy `LabelVerificationApp/` to Vercel**
   - Details: connect the repo, set required environment variables (Gemini API key, Vercel KV/Blob bindings), confirm `maxDuration` settings are honored on the deployed tier
   - Estimated effort: Medium
2. [ ] **README.md — setup and run instructions**
   - File(s): `LabelVerificationApp/README.md`
   - Details: local setup, required env vars, `npm run dev`/build commands (once decided — not yet scaffolded), deployed URL link
   - Estimated effort: Small
3. [ ] **Write-up — approach, tools, assumptions**
   - File(s): `LabelVerificationApp/README.md` (or a separate `WRITEUP.md`) — per `REQUIREMENTS.md` deliverable #1
   - Details: must explicitly state the acknowledged-unknown assumptions already identified in `NOTES.md`: (a) the CSV-manifest-plus-filename-keyed-images batch format is an educated guess about COLA's real shape, not a researched fact; (b) no local/self-hosted extractor was built, with the cost/latency/accuracy reasoning from `NOTES.md`'s "Extraction model: local vs cloud" entry; (c) the `flaggedFields` inline-`(label says ...)` format is tentative, flagged for revisit once real batches are tested
   - Estimated effort: Medium

**Validation**:
- [ ] Deployed URL loads and completes a real single-verify round-trip
- [ ] README instructions followed from a clean checkout reproduce a working local dev environment
- [ ] Write-up covers all three items above plus any trade-offs/limitations surfaced during implementation

---

## ⚠️ Technical Considerations

### Dependencies

- Gemini API (free tier; paid tier as a fallback per `NOTES.md` "Concurrency" entry) — the only extraction integration
- Vercel KV — batch/row ephemeral state
- Vercel Blob — batch label image storage, direct browser upload
- Vercel hosting/deployment

No other third-party services — do not introduce anything beyond Next.js/Vercel/Vercel KV/Vercel Blob/Gemini API without checking with the user first.

### Constraints

All `CLAUDE.md` Non-Negotiable Constraints apply throughout — no durable persistence beyond the described ephemeral batch store, no accounts/auth, no rounding tolerance on Alcohol Content/Net Contents (prompt-enforced as of 2026-07-10, not code-enforced, for these two fields), no cross-system unit conversion on Net Contents (same-system metric conversion like mL↔L is allowed), no model-judged status for Government Warning specifically (still algorithmic — Alcohol Content/Net Contents moved to model-judged 2026-07-10, see `ARCHITECTURE.md`'s "Matching" section), no hardcoded application field set, no local/self-hosted extractor.

### Risks & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Gemini latency exceeds ~5s target on real images | ~~High~~ Resolved | — | Phase 0 spike measured 1.7-2.2s on real calls — well under budget, no longer a risk |
| Gemini free-tier rate limit forces slow batch completion (~20 min for 200-300 labels at N=1) | Medium | Confirmed | Not a blocker — user confirmed 20 min fits `REQUIREMENTS.md`'s bar as-is; paid tier is a trivial, low-cost fallback if a faster demo is later wanted (see "✅ Gemini Model, Latency & Concurrency") |
| Value-guided extraction anchoring bias (model reports the hint value even when wrong) | Medium | Medium | Accepted trade-off per `ARCHITECTURE.md`; mitigated by keeping strict-field decisions in deterministic code, never the model's judgment |
| Time-box pressure causes batch flow (Phases 5-9) to be cut short | Medium | Medium | Phases sequenced so single-verify (Phase 4) is a complete, demoable core on its own if batch work doesn't finish |
| Vercel serverless body-size limit breaks large batch uploads | Medium | Low | Direct browser-to-Blob upload (Phase 6) avoids routing images through API routes entirely, per `ARCHITECTURE.md` |
| Model IDs shift again before implementation (already happened once during planning) | Low | Medium | Re-verify `gemini-3.1-flash-lite` is still current at Phase 2, don't trust this plan's model name blindly |

### Open Questions

None remaining — all three items originally flagged (commit/push cadence, testing strategy, Gemini concurrency `N`) are resolved. See "✅ Open Decisions — All Resolved" above.

---

## 📁 Files Involved

### New Files

All files are new (pre-implementation repo). Full manifest is `ARCHITECTURE.md`'s "Directory Structure" section, reproduced task-by-task above across Phases 1-9. Key entry points:
- `LabelVerificationApp/app/page.tsx` — main UI
- `LabelVerificationApp/app/api/verify/route.ts` — single-verify endpoint
- `LabelVerificationApp/app/api/batch/route.ts`, `LabelVerificationApp/app/api/batch/[id]/process/route.ts`, `LabelVerificationApp/app/api/batch/current/route.ts` — batch endpoints
- `LabelVerificationApp/lib/matching/verify.ts` — verification orchestrator
- `LabelVerificationApp/lib/extraction/geminiExtractor.ts` — Gemini adapter

### Modified Files

- `CLAUDE.md` (outer repo) — per `NOTES.md`, its persistence-related Non-Negotiable Constraint was already rewritten to carve out the ephemeral batch-store exception; no further changes expected from this plan unless implementation surfaces a new constraint conflict
- `ARCHITECTURE.md` (outer repo) — treat as stable/authoritative for this plan; do not edit during implementation without flagging to the user first

### Related Files (for reference)

- `RequirementPrompt.md` — original stakeholder context, useful for the write-up's "assumptions made" section
- `NOTES.md` — working log of resolved/unresolved design questions; check before assuming any area is settled

---

## 🧪 Testing Strategy

**Resolved 2026-07-09 — scoped, not full-coverage.** Automated unit tests (Vitest) are written for the deterministic domain logic only: the algorithmic matchers (`exactMatch.ts`, still live in the dispatch path; `numericMatch.ts`/`unitMatch.ts`, dormant as of the 2026-07-10 matching revision but still tested, correct code), the dispatcher (`fieldMatchers.ts`), the orchestrator's rollup logic (`verify.ts`), the batch CSV pairing parser (`csvManifestParser.ts`), and the results CSV export (`resultsToCsv.ts`) — all pure functions, no network/DB, cheapest to test and highest-risk if wrong. Note that as of 2026-07-10, only Government Warning's algorithmic guarantee is enforced by this test suite at runtime — Alcohol Content/Net Contents' no-rounding/no-cross-system-conversion rules are enforced by extraction prompt instruction instead, which this test suite cannot verify (there's no automated test coverage for live model behavior, per the "explicitly out of scope" note below).

Test cases are drawn directly from `ARCHITECTURE.md`'s own worked examples — the `45%`/`44.9%` ABV example, the `750 mL`/`750 L` example, the row-1042/1043/1044 CSV example — write the test alongside (or just before) the implementation for this layer specifically, since the spec already reads as test cases; see each Phase 3/5/9 task above for the exact fixtures.

**Explicitly out of scope, given the time-box**: no automated tests for API routes, the Gemini extraction adapter's live calls, the KV/Blob persistence layer, or UI components. These stay covered by each phase's existing manual/functional "Validation" checklist instead (Phases 2, 4, 6, 7, 8). State this scoping decision explicitly in Phase 10's write-up as a deliberate trade-off, not an omission.

---

## 💬 Code Commenting Standard (added 2026-07-09)

**Overrides this environment's default for this project specifically.** The default behind these tools is minimal, WHY-only commenting (no restating what code does). The user explicitly wants the opposite here: **code commented throughout** — most functions and non-trivial blocks get a comment explaining what they do, not just why a non-obvious choice was made. Closer to a teaching/walkthrough codebase than the terse default.

Applies to all implementation code across Phases 1-9. Does not apply to Phase 0 (spike script, already deleted) or Phase 10 (README/write-up, which is prose, not code). Each phase's Validation checklist below has its own checkbox for this so it isn't silently dropped as phases get built — check the box only after actually reviewing the phase's files for comment coverage, not by assumption.

**Retroactive note**: Phase 1 was built before this standard was added. Its checklist below includes an unchecked item to go back and add comments to its files (scaffold stubs, `lib/types.ts`) rather than assuming it's already compliant.

---

## 📚 References

### Documentation

- `ARCHITECTURE.md` — authoritative design document; every phase above maps to a named section (Directory Structure, Data Model, Key Decisions)
- `REQUIREMENTS.md` — distilled functional/non-functional requirements and deliverables
- `RequirementPrompt.md` — raw stakeholder interview source
- `NOTES.md` — working log of design revisits; several items marked "needs reflecting" in that file were confirmed already reflected into `ARCHITECTURE.md` as of this planning session — trust `ARCHITECTURE.md`'s current text over stale labels in `NOTES.md`, except for the three genuinely unresolved items called out in Open Decisions above
- `CLAUDE.md` — Non-Negotiable Constraints, checked at each phase's Validation step

### Related Work

None — greenfield project, no prior implementations or PRs to reference.

---

## 🚀 Deployment & Rollout

### Prerequisites

- [x] Gemini API key obtained (used for the Phase 0 spike) — store as an environment variable in the real app, never hardcoded; consider rotating the key used during planning since it passed through chat
- [ ] Vercel account/project set up with KV and Blob bindings available
- [x] Phase 0 spike findings recorded — `maxDuration`/client-abort (Phase 4) confirmed as-is, `N=1` (Phase 7) resolved

### Deployment Steps

1. Connect `LabelVerificationApp/` to Vercel (Phase 10)
2. Configure environment variables and KV/Blob bindings in the Vercel project
3. Deploy; confirm the working URL round-trips a real single-verify request

### Rollback Plan

No production traffic/users — this is a take-home prototype with a single demo URL. Rollback is simply reverting to the previous Vercel deployment if a new one breaks.

### Monitoring

Not in scope per `REQUIREMENTS.md`'s non-goals (no production-grade compliance/monitoring needed). Manual smoke-test after each deploy is sufficient.

---

## 📊 Success Metrics

### Immediate

- Deployed URL loads and completes a single-verify round-trip correctly

### Short-term

- Batch flow completes a 200-300 row synthetic batch within a reasonable wall-clock time given whatever `N`/rate-limit ceiling Phase 0/7 determine

### Long-term

Out of scope — this is a one-time prototype deliverable, not a maintained production service (per `REQUIREMENTS.md`/`CLAUDE.md` non-goals).

---

## 💬 Notes & Observations

- This plan intentionally does not re-explain rationale already captured in `ARCHITECTURE.md` — if a task's purpose is unclear, read the named `ARCHITECTURE.md` section before asking; it contains the "why," this plan only contains the "what/where."
- Phase 4 is the single most important checkpoint in this plan: if time runs short, a complete Phase 0-4 (spike + stateless single-verify, fully working and deployed) satisfies `REQUIREMENTS.md`'s "working core application" evaluation bar even without batch. Do not skip ahead to batch work (Phases 5-9) before Phase 4 is genuinely demoable.

---

**Last Updated**: 2026-07-09
**Generated By**: `/plan` command
**Next Steps**: All open decisions resolved and Phase 0 complete. Use `/kickoff LABEL_VERIFICATION_APP` to start implementation in a fresh session, beginning with Phase 1 (App Scaffold + Core Types).
