# Architecture, Design, Technical Decisions — AI-Powered Alcohol Label Verification App

Priorities driving every decision below, in order: **accuracy** of the label-vs-application check, **ease of use** for a low-tech-comfort audience, **batch handling** for large importer submissions.

This is deliberately the simplest version that satisfies those three priorities. Single-label verification is fully stateless. Batch verification adds one minimal, ephemeral, TTL'd server-side store — purely so a browser refresh mid-run doesn't wipe a 200-300 label batch — not a system of record, no accounts, nothing durable.

## Stack

- **Next.js + TypeScript**, deployed to Vercel. Single repo, frontend + API routes together, one deploy produces the working URL required by the deliverables.
- **Vercel KV** (Redis-like) — ephemeral batch/row state for the batch flow only. No relational schema/migrations: the access pattern is direct key lookups (`cookie → batch id`, `batchId:rowId → row state`), so a key-value store fits without the overhead of a relational DB.
- **Vercel Blob** — label images uploaded during a batch, referenced by key from the KV records. Uploaded directly from the browser (signed-URL client upload), not through an API route — Vercel serverless functions have a request body size limit (~4.5MB) that a 300-image batch would blow past immediately.
- Single-verify results still live in client-side state only, for the duration of the page — no server-side trace of a single verification after the response is sent.

## Pattern

Two flows, not one — single-verify stays a plain stateless request/response; batch is server-orchestrated and chunked, with ephemeral state to support resume.

```
Presentation   → Upload UI (single + batch), results table
Application    → Verification service: orchestrates extract → match (single-verify)
                  Batch service: chunked processing loop, resume-on-reload (batch)
Domain         → Matching rules: algorithmic (exact, numeric, unit-aware) for regulated
                  fields; model-judged (fuzzy/open fields) via the extraction call itself
Infrastructure → LabelExtractor (port/adapter), BatchInputParser (port/adapter),
                  ephemeral batch store (KV + Blob)
```

## Directory Structure

```
/app
  page.tsx                        — main UI: single + batch upload, results table
  /api/verify/route.ts            — POST: one image + application JSON → VerificationResult
                                     (fully stateless, unchanged by the batch persistence work)
  /api/batch/route.ts             — POST: register a new batch (blob refs + parsed CSV rows),
                                     sets the anonymous cookie if none exists
  /api/batch/[id]/process/route.ts — POST: process up to N pending rows (the concurrency cap),
                                     writes results to KV, returns updated progress
  /api/batch/current/route.ts     — GET: reads the cookie, reports an unfinished batch if one
                                     exists in KV, for the resume-prompt flow
/components
  UploadForm.tsx                  — single-label upload
  BatchUploadPanel.tsx            — two-zone batch upload (CSV zone + image zone), template
                                     link, preflight pairing summary + confirm, uploads images
                                     directly to Blob, registers the batch, then polls
                                     /api/batch/[id]/process in a loop while its tab holds the lock
  ResultsTable.tsx                 — status badges (Matched / Mismatched / Needs Review),
                                     expandable per-row field comparison (includes the model's
                                     explanation text for fuzzy-field judgments)
/lib
  /batchInput
    types.ts                     — BatchInputParser interface, BatchEntry, PairingError types
    csvManifestParser.ts         — default implementation: CSV text + image file list →
                                     BatchEntry[] + PairingError[], pairing by fileName column
  /extraction
    types.ts                     — LabelExtractor interface, LabelFields type. extract() now
                                     takes the application's field names *and* expected values
                                     as search hints, not just the image (value-guided
                                     extraction). Returns, per field: foundText; for
                                     fuzzy-category fields, also a model-judged status
                                     (matched/needs_review/mismatched) + a short explanation;
                                     for the warning, isWarningBold + a confidence signal.
    geminiExtractor.ts            — adapter: one structured-output Gemini call per label,
                                     given the hints above, returns everything in one response
  /matching
    exactMatch.ts                 — Government Warning: word-for-word body match (case-
                                     insensitive) + hard ALL CAPS check on the "GOVERNMENT
                                     WARNING:" prefix + best-effort bold check, operating on
                                     the transcribed text extraction returned; attaches a
                                     fixed, code-owned explanation when the bold check is
                                     what produces needs_review, since applicationValue/
                                     extractedValue text can be identical in that case
    numericMatch.ts                — Alcohol Content: parses the % value from both sides,
                                     compares as an exact number (no tolerance, no fuzziness)
    unitMatch.ts                   — Net Contents: parses value + unit (space-insensitive),
                                     normalizes unit spelling, requires both to match exactly
    fieldMatchers.ts                — dispatches by field name: alcoholContent/netContents/
                                     warningText go through their algorithmic matcher above;
                                     every other field (known-fuzzy or unrecognized) passes
                                     through *unchanged* — its status and explanation already
                                     came back from the extraction call, nothing left to compute
    verify.ts                       — orchestrates: build extraction hints from ApplicationData →
                                     call extractor → algorithmic-match the three strict fields →
                                     pass through the model's judgment for everything else →
                                     assemble FieldResult[] + rollup status
  /persistence
    cookie.ts                      — anonymous batch-owner id: read existing or issue new
    kvStore.ts                     — batch/row state read/write, TTL (~48h)
    blobUpload.ts                  — client-upload helper for label images
    batchLock.ts                   — single-active-tab enforcement: a sessionStorage-held
                                     tab id claims the batch and renews a heartbeat on the
                                     KV record; a second tab sees the lock held and is blocked
  types.ts                         — ApplicationData, FieldResult (includes an optional
                                     explanation field, populated for model-judged fuzzy
                                     results), VerificationResult
  /export
    resultsToCsv.ts                 — serializes VerificationResult[] to CSV in the same
                                     shape as the input manifest, plus status + flaggedFields
                                     (see Key Decisions — not the earlier wide-format design)
```

## Data Model

```
ApplicationData     (alcoholContent, netContents, warningText, ...and any other column
                      present in the manifest — not a fixed/closed set, see Matching below)

FieldResult          (field, applicationValue, extractedValue,
                       status: matched | mismatched | needs_review,
                       explanation?: string)   — present when status came from the model's
                                                  own judgment (fuzzy fields), or when the
                                                  Government Warning's bold-confidence check
                                                  is what pushed it to needs_review (a fixed,
                                                  code-owned message, not model-generated)

VerificationResult   (fileName, fields: FieldResult[],
                       overallStatus: matched | mismatched | needs_review)   — rollup

BatchEntry           (fileName, image, applicationData)   — output of BatchInputParser

--- batch persistence (KV, ephemeral, TTL'd — not part of the single-verify data model) ---

BatchRecord          (batchId, ownerCookie, createdAt, totalCount, lockedByTabId?)
BatchRowState         (fileName, applicationData, blobRef, status: pending | in_flight | done,
                       result?: VerificationResult)
```

`alcoholContent`, `netContents`, and `warningText` are called out because they get algorithmic matchers (numeric, unit-aware, strict-exact respectively). Every other field — brand name, class/type, producer, country of origin, or anything else present in the application — is checked too, via the model's own judgment returned during extraction, not a separate matcher.

Rollup precedence: any field `mismatched` → `mismatched`; else any field `needs_review` → `needs_review`; else `matched`.

## Key Decisions

### Single-verify stays stateless; batch gets a minimal, ephemeral server-side store
`POST /api/verify` is unchanged: one image + one application record in, one result out, nothing written anywhere after the response is sent. Batch is different — the goal shifted from "the browser remembers its own progress" (an earlier, purely client-side IndexedDB design) to "the server runs the batch and can tell a returning browser what's already done." That requires real, if lightweight, server-side state: an anonymous cookie identifies the browser, a KV record tracks per-row progress, and Blob storage holds the images while the batch runs. This is deliberately **not** the "database, batch history, crash-resume, persisted human-review decisions" design considered and rejected early on — there's no accounts, no cross-session history, and everything auto-expires (~48h TTL). It exists solely to survive an accidental refresh or crash mid-batch; nothing about single-verify or long-term storage changes.

### Extraction is behind a swappable interface, backed by Gemini's free tier
`LabelExtractor.extract(image, fieldHints) → ExtractionResult` is the only integration point with an external ML service — this isolates the one place a network-constrained/on-prem deployment would need to change. The default implementation calls the **Gemini API free tier**, chosen for two reasons together, not just cost: it's genuinely free at low volume, and the Flash-tier models are optimized for low latency, serving the 5-second target below. A single request asks for everything at once via structured output — transcribed text for every field, a model-judged status + explanation for fuzzy-category fields, and the warning's bold-check signal — not one call per field or per concern; output length is a major driver of LLM latency, and multiple round-trips would multiply it.

**No local/self-hosted extractor gets built.** Network isolation is a real future-deployment consideration (per `REQUIREMENTS.md`'s network constraint), but Vercel serverless can't run a real vision-language model at all (no GPU, no persistent process) — "local" would mean standing up and hosting a separate always-on inference server, real ops/cost burden that smaller open-weight models don't clearly repay in extraction accuracy versus Gemini. The interface stays the designed swap point; the local path stays documented, not implemented, for this build. Free-tier terms and rate limits should be verified against current provider docs before implementation, not assumed stable.

### Extraction is value-guided, not blind
The model receives each field's **name and the application's own expected value** as a search hint during extraction — not just a fixed schema of field names. This matters because real labels don't have headers like "Brand Name:" identifying which text is which; the model needs to know what it's looking for to locate genuinely unlabeled fields, and it also needs to be told about *whatever* fields the current application actually has (an open set, not a hardcoded list) rather than a closed schema that would miss any field the design didn't anticipate.

**Known trade-off, accepted deliberately**: giving the model the expected value while it searches introduces some anchoring risk — a model told the expected answer is more likely to report something close to it, even on an ambiguous image. This is mitigated by keeping the model's role for strict fields limited to *transcription* (report the text found, not a judgment) — the actual match/mismatch decision for Government Warning, Alcohol Content, and Net Contents stays in separate, deterministic code that never sees the hint as anything but "the text to compare against," not "the answer to confirm." For the fuzzy category, where the model's own judgment *is* the decision (see below), this trade-off is accepted more directly, in exchange for handling labels where nothing is explicitly headed.

Whether field-name-only guidance would have been sufficient for some fields (skipping the hint, and its anchoring risk, entirely) is an open, empirical question — not yet validated against real sample label images.

### Latency budget for the ~5 second target
Budget: ~0.3s upload + ~3-4s extraction (the dominant cost, now doing more per call but still one call) + negligible matching time + ~0.2s response. Two concrete guards, not just a target, deliberately ordered so the client never gives up on a server call that's still on track to finish:
- `maxDuration` is set explicitly on `/api/verify` (e.g. 8s) — enough buffer for an occasional slow call, low enough to fail fast rather than hang and to avoid burning Gemini rate-limit quota on a call nobody's waiting for anymore. This constrains hosting tier and needs checking against Vercel's plan limits.
- A client-side abort (~10s, deliberately *after* `maxDuration`) is a backstop against the server not responding at all (network failure, dropped connection) — not a race against the server's own timeout. A timeout surfaces as the same error-badge-with-retry state as any other failed verification, no separate mechanism needed.

Each result shows its elapsed time in the UI (e.g. "Verified in 2.3s") — cheap to add, and directly counters the prior vendor pilot's failure mode by making speed visible rather than assumed.

Whether the chosen provider/model actually hits ~3-4s on a real label image, now with a richer per-call output schema (transcription + fuzzy judgments + explanations, not just transcription), is an empirical question, not a design one — a short spike (call the API on one real test image, measure it) before building the rest of the app is the way to find out early rather than after the UI is built around an assumption.

### Applications are assumed valid — the tool checks label-vs-application consistency, not regulatory compliance
The application data is trusted as the source of truth for what a label *should* say, not independently validated against TTB regulations. This tool isn't a compliance engine that knows which fields a given beverage type is required to have — it's a matcher: for every field present in the application, confirm the label says the same thing. A field absent from the application (e.g. no country of origin on a domestic product) is simply not checked on the label — this is also how beverage-type variance (ABV exceptions, import-only country of origin) is handled, without needing to encode TTB's regulatory matrix.

### Matching: Government Warning stays algorithmic; Alcohol Content and Net Contents move to model-judged-with-strict-instructions; everything else stays model-judged as before
**Revised 2026-07-10 — supersedes the "three fields algorithmic, one model-judged" split below the line for two of those three fields.** Government Warning keeps its original fully-algorithmic treatment unchanged (see below) — it's already built and working, and the ALL CAPS/exact-wording check it does is cheap, deterministic pattern-matching, not a judgment call. Alcohol Content and Net Contents, however, move into the model-judged category: the model returns `status`+`explanation` for them directly during extraction, the same way it already does for the fuzzy/open category, rather than a separate algorithmic pass afterward.

**Because removing the algorithmic layer also removes its no-tolerance guarantee, that guarantee now has to come from the prompt instead of from code.** The extraction prompt explicitly instructs the model that Alcohol Content and Net Contents require **exact** equality: no rounding, no "close enough." For Net Contents specifically, the instruction is more nuanced than a blanket "no conversion": **same-system metric conversion is allowed** (`750 mL` and `0.75 L` are the same quantity and should match), but **cross-system conversion is not** (mL to fluid ounces, or any other metric-to-imperial conversion, is never treated as equal even if the underlying volume matches) — same-unit-family conversion is low-risk arithmetic a model can be trusted with; cross-system conversion is exactly the kind of error-prone, easy-to-get-subtly-wrong judgment call this design has otherwise tried to keep out of model hands. This is weaker than a code-enforced guarantee either way (a model can still misjudge despite clear instructions, which a deterministic comparison cannot), and that weakening is a known, accepted trade-off, not an oversight.

**The algorithmic matchers for these two fields (`numericMatch.ts`, `unitMatch.ts`) are not deleted, just not wired in.** They stay in the codebase as working, tested code — `fieldMatchers.ts` passes `alcoholContent`/`netContents` through unchanged now (the same code path the fuzzy category always used), rather than dispatching to them. Re-enabling them later (post-deployment, if time allows) is a matter of restoring that dispatch, not rebuilding the matchers from scratch.

**Known risk, accepted deliberately.** `REQUIREMENTS.md` states exact numeric correctness as a real requirement, and evaluation explicitly rewards "attention to requirements" — moving Alcohol Content and Net Contents off deterministic code is a conscious trade-off for shipping sooner, with precision on these two fields as a planned follow-up, not abandoned scope. Government Warning's exactness requirement (the one `RequirementPrompt.md`'s stakeholder interview emphasizes most) is unaffected by this change — it keeps its code-enforced guarantee.

---

*The following described the original design (all three fields algorithmic) and is kept for reference for Government Warning specifically (still current) and as what re-enabling the dormant Alcohol Content / Net Contents matchers above would restore.*

Different fields need different correctness checks — treating everything as "similar enough" text would let real discrepancies in regulated values slip through:

- **Government Warning — strict, word-for-word, fully algorithmic.** The warning body is compared case-insensitively but otherwise exactly against the transcribed text extraction returns — no similarity tolerance; wording differences are a mismatch, not "close enough." Separately, the "GOVERNMENT WARNING:" prefix must literally appear in ALL CAPS on the label — a hard formatting check on the label itself, not case-insensitive.

  **Bold is checked as a best-effort signal, not a hard check.** ALL CAPS is a text property that comes along with transcription for free, reliable enough to be a hard pass/fail. Bold is a visual/stylistic judgment, inherently less reliable — the extractor is asked directly whether the text appears bold, in the same call. Confident + bold + everything else checking out → `matched`; not-bold or anything less than confident → `needs_review`, never a silent pass or an automatic fail on bold alone. Because `applicationValue`/`extractedValue` text can be identical in this case (the wording matches; only the styling is in question), the `needs_review` result carries a fixed, code-owned `explanation` (e.g. "bold styling could not be confirmed") — without it, nothing in `FieldResult` would show why a textually-matching warning was flagged.
- **Alcohol Content — numeric, fully algorithmic, exact equality.** The percentage is parsed from both the application and the transcribed label text and compared as a number — no rounding or tolerance band. `45% Alc./Vol.` and `45% Alc./Vol. (90 Proof)` match because the parsed value is identical; `44.9%` and `45%` do not, however small the difference. If a proof number is present on *both* sides, it's compared too, with the same zero-tolerance rule — `45% Alc./Vol. (90 Proof)` vs `45% Alc./Vol. (91 Proof)` is a mismatch even though the percentage alone matches, since a typo could otherwise land only in the proof portion and slip through undetected. Proof stated on just one side (or neither) isn't required to match anything, since there's nothing to compare it against — still consistent with "a field absent from the application isn't checked."
- **Net Contents — number and unit both required, fully algorithmic, no cross-unit conversion.** Value and unit are parsed separately (whitespace-insensitive, unit spelling normalized) but never converted across units: `750 mL` vs `750 mL` matches; `750 mL` vs `750 L` is a **mismatch**, deliberately, even though a human might read past it — a numeric-only comparison would have missed a real unit error entirely.
- **Everything else — the fuzzy/open category — judged directly by the model, not scored by an algorithm.** Brand name, class/type, producer, country of origin, and any field present in the application that isn't one of the three above (an open set, not a fixed list — unrecognized field names fall into this category, never silently skipped). The model, given the application's expected value as a search hint during extraction, returns its own status judgment (`matched` / `needs_review` / `mismatched`) directly, along with the transcribed text it found and a short explanation of its reasoning.

  **Why not a percentage + code-owned threshold, the way this category worked before**: a model self-assessing similarity is unlikely to ever cleanly report 100%, even for a genuinely correct match — it hedges (95%, 99%, etc.). A fixed numeric threshold tuned for algorithmic scores (which cleanly hit 100/0) would misbehave against model-sourced scores of that shape. Direct categorical judgment sidesteps the mismatch between how the two kinds of scores behave, rather than trying to tune one threshold that works for both.

  **Scope of the trade-off, stated plainly**: this confines model judgment — and the reduced determinism/auditability that comes with it — to the one category that was already inherently a judgment call. The original design's fuzzy matcher also had a `needs_review` band for exactly this reason; similarity was always a heuristic proxy, not a certainty. The three regulated fields above keep their deterministic, no-tolerance guarantees completely untouched — the model's own judgment is never the deciding factor for Government Warning, Alcohol Content, or Net Contents.

This still makes `ApplicationData` an open field set for matching purposes: three known field names get an algorithmic matcher; every other field, known or not, gets the model's own direct judgment.

### BatchInputParser: the upload format is a swappable interface, not hardcoded into the UI
`BatchUploadPanel.tsx` depends only on `BatchEntry[]`/`PairingError[]`, never on CSV text or filename-matching logic directly:

```
BatchInputParser.parse(csvText, imageFiles) → { entries: BatchEntry[], errors: PairingError[] }
BatchEntry   = { fileName, image, applicationData }
PairingError = { fileName, reason: "no_matching_image" | "no_matching_row" }
```

The CSV-specific logic (parsing, filename matching, pairing validation) lives entirely inside one default implementation, `csvManifestParser.ts` — swappable later (a different manifest format, a different pairing scheme) without touching the UI, the concurrency/dispatch logic, or the batch API. `errors` matters as much as `entries`: pairing problems surface before anything is sent to the server, not discovered mid-batch.

### Batch upload UI: two labeled zones, explicit `fileName` column, preflight confirm
**Two separate upload zones**, not one combined drop target and not a native folder picker: a CSV manifest zone (with a "Download CSV template" link right there, so the format is discoverable without documentation) and a label-images zone (plain multi-file picker/drag-drop, not `webkitdirectory` — inconsistent browser support, and can't handle images pulled from more than one location). Two explicit, labeled steps are easier for a low-tech-comfort/first-time user (the 73-year-old benchmark) to reason about than one zone silently accepting mixed file types.

**The CSV manifest has a dedicated `fileName` column, separate from `id`.** `id` is a free-form label identifier (e.g. a COLA application number); `fileName` is the exact expected image filename used for pairing — keeps "what identifies this label" and "what file it's in" as separate concerns, rather than assuming `id` values are filename-safe or unique-as-filenames.

**Preflight validation shows a summary and requires explicit confirmation before anything is sent.** After both CSV and images are provided, before any upload/verification call: validate pairing client-side (via `BatchInputParser`) and show counts plus specifics for anything unmatched (e.g. "298/300 matched; 2 rows have no image; 1 image has no row"). The agent clicks something like "Proceed with 298 matched" to continue, or fixes the mismatch and re-uploads — nothing is silently skipped, but one filename typo in a 300-label batch doesn't hard-block the whole run.

**Assumption, not a researched fact**: the real legacy COLA system's data format is unknown (out of scope per `REQUIREMENTS.md`'s non-goals) — a CSV manifest + filename-keyed images is an educated guess at a reasonable stand-in, on the reasoning that agents/importers would plausibly want a portable format they can download/re-upload elsewhere, and CSV is the common denominator for that. Worth stating as an acknowledged unknown in the write-up, not a verified fact.

### Batch processing is server-driven and chunked, paced to the provider's rate limit — with resume across a browser restart
A batch is registered server-side (`POST /api/batch`, given the parsed entries plus Blob references for the already-uploaded images) and processed by the browser repeatedly calling `POST /api/batch/[id]/process` in a loop **while its tab is open** — each call picks up to N pending rows (the concurrency cap), verifies them in parallel within that one request, writes results to KV, and returns updated progress. Nothing processes while no tab is asking; this is pause-and-resume, not an unattended background job (a true always-running job would need a persistent worker/queue independent of any request — a materially bigger architecture, not chosen here).

**Concurrency, precisely**: there's no literal thread pool anywhere in this — N in-flight calls awaited together (`Promise.all`) just means their wait time overlaps instead of stacking sequentially (N=5 at ~4s each finishes a round in ~4s, not 20s). The real ceiling on total throughput is the extraction provider's own rate-limit *policy* (requests/minute), not a thread count on either side — pushing N past that ceiling just produces 429s, handled with retry-and-backoff, rather than faster completion. The actual current Gemini rate limits (free-tier RPM/RPD, paid-tier pricing) haven't been checked yet — an action item before N is finalized — and paying for a higher tier is an accepted option if the free tier proves too restrictive for acceptable batch completion time.

**Resuming across a browser restart**: an anonymous cookie (opaque id, no login, no PII) identifies the browser. On load, `GET /api/batch/current` reads the cookie and reports whatever's in KV for it — "187 of 300 already verified, resume?" — re-hydrating done rows without re-verifying them, and re-sending only rows still `pending` or `in_flight` (anything mid-flight at the moment of a crash can't be trusted as complete, so it's safely redone; `/api/batch/[id]/process` has no side effects beyond writing its own result, so redoing a few rows is harmless).

**Single active tab per browser, enforced, not just assumed.** Cookies are shared across every tab of the same browser (unlike `sessionStorage`, which is tab-scoped) — without an explicit lock, two tabs on the same batch would race each other for the same pending rows. A tab-scoped id in `sessionStorage` claims the batch and renews a heartbeat on the KV record; a second tab sees the lock held and is blocked/warned rather than competing.

**What this design does and doesn't buy you, stated plainly**: it removes the client's own concurrency/retry bookkeeping (that lives server-side now) and lets one real concurrency ceiling be enforced regardless of how many tabs might exist. It does **not** buy resilience against the user clearing their browser data — a cookie is exactly as fragile as any other browser storage to "clear browsing data," and this isn't a cross-device/cross-browser solution; the cookie is still scoped to one browser. Everything is TTL'd (~48h) and scoped to the one active/most-recent batch per cookie — not a growing history, not a durable audit trail, no accounts.

### Needs Review is a flag, not a workflow
Fields that are genuinely ambiguous — too uncertain to call matched or mismatched outright — roll the entry up to `needs_review`, shown as a distinct badge so an agent can find it without scanning past everything that matched cleanly or was clearly, unambiguously mismatched (a clear mismatch needs no review right now; it's already a definite result). A `needs_review` result always carries a reason for the ambiguity, not a bare status: for fuzzy-category fields, that's the model's own stated explanation; for the Government Warning's bold-confidence case, it's a fixed, code-owned explanation instead (see Matching, above). There is no approve/reject action or stored decision — the tool's job is to surface what needs a human look, not to manage the resolution of it. The agent's actual decision happens outside this tool (it isn't integrated with COLA), so persisting a decision here would have nowhere meaningful to go.

### No user accounts — the batch-resume cookie is not an account
The stated UX bar (a 73-year-old first-time user) argues against login friction, and nothing in the requirements calls for per-agent data isolation. The anonymous cookie used for batch resume is worth distinguishing from an account explicitly: no login, no password, no personal information, no identity beyond "this is the same browser as before" — a claim-check ticket, not a session in the accounts sense. There's still nothing durable to scope access to beyond the one active batch, which expires on its own.

### Results are downloadable as a CSV in the same shape as the input, plus status and flagged fields
A **Download Results** button (batch view) serializes the in-memory results to CSV, entirely client-side. This is how the design's persistence gap (batch state is ephemeral and TTL'd, not a durable record) gets mitigated: not by the tool keeping a record, but by handing the agent a record they control.

**Format: same shape as the input CSV, plus two added columns** — not the originally-considered wide format (a triplet of columns per field). All original input columns (`id`, `fileName`, `brandName`, ...) are carried through unchanged, so the export reads as "the same file, with results added," not a reshaped report. `status` is the row's rollup (`matched`/`mismatched`/`needs_review`, same precedence as above — any `mismatched` field wins, else any `needs_review`, else `matched`). `flaggedFields` is populated only when `status` isn't `matched`, listing every field that was `mismatched` or `needs_review` (not every field — fields that matched cleanly aren't repeated, since the agent already sees their application value in the carried-through columns). Multiple flagged fields are joined with `"; "` (not a comma — commas already appear inside individual values like `750mL, 1L`), each entry shaped `fieldName (label says <extractedValue>)` — except when a field carries a fixed or model-generated `explanation` and the extracted text alone wouldn't convey why it was flagged (fuzzy-field model reasoning, or the Government Warning's bold-uncertain case), in which case the entry is shaped `fieldName (<explanation>)` instead.

Example:
```
id,fileName,brandName,alcoholContent,netContents,status,flaggedFields
1042,IMG_001.jpg,Stone's Throw,45%,750mL,mismatched,"alcoholContent (label says 44%)"
1043,IMG_002.jpg,Old Barrel,40%,1L,matched,
1044,IMG_003.jpg,Highland Reserve,40%,750mL,needs_review,"brandName (label says Highland Reserve Distillers — model unsure if it's the same entity); warningText (bold styling could not be confirmed)"
```

Row 1042 mismatches on `alcoholContent` alone (45% on the application, 44% on the label) — a strict numeric field, so the row rolls up to `mismatched`, not `needs_review`, per the precedence rule; `netContents` isn't listed because it matched, and matched fields are never repeated in `flaggedFields`. Row 1044 shows both flavors of `needs_review`: a fuzzy field flagged with the model's own reasoning, and the Government Warning flagged with its fixed bold-uncertainty explanation rather than a redundant "label says <identical text>."

The `(label says <extractedValue>)` inline detail is the one piece of this still tentative — it may prove noisy once real batches are tested; a bare field-name list might be clearer in practice. Worth revisiting once there's an actual CSV to look at.

## Trade-offs & Limitations

- **Batch persistence is ephemeral, not a safety net against clearing browser data.** The cookie identifying a browser is exactly as fragile as any other browser storage to "clear browsing data" — this design solves "accidental refresh/crash mid-batch," not "survive the user wiping their browser" or "resume on a different device/browser."
- **A failed individual row is trivially retryable, not specially handled.** A failed verification (bad image, extraction API error, timeout) just shows an error badge for that row with a retry button — no state machine or reconciliation needed, whether in single-verify or as part of a batch chunk.
- **Fuzzy-field judgment is model-based, not deterministic.** The trade-off accepted for the open/fuzzy category specifically: the model's own status judgment (not a code-owned threshold) decides matched/needs_review/mismatched for brand name, producer, class/type, country of origin, and unrecognized fields. Combined with giving the model the application's expected value as a search hint (needed since real labels aren't headed like form fields), there's an accepted anchoring-bias risk for this category — mitigated by keeping the three regulated fields' decisions fully algorithmic and untouched by this risk.
- **Bold formatting on the Government Warning is a best-effort signal, and testing shows it currently skews toward always-confident, not genuinely discriminating.** The code path is sound — an unconfident or negative answer defers to `needs_review` rather than being trusted or ignored — but empirical testing (2026-07-11, six synthetic label variants spanning font-weight 200-700 across two font families, including an extreme low-contrast case with `getComputedStyle` confirming the CSS actually applied) got `isWarningBold: true, boldConfident: true` in every case, including ones that were visibly not bold. Strengthening the extraction prompt's instruction (explicitly telling the model to compare the prefix's stroke weight against the surrounding body text, and not to default to "bold" just because Government Warnings are conventionally printed that way) made no measurable difference — identical results before and after. The most likely explanation is a genuine capability limit of `gemini-3.1-flash-lite` (chosen for latency, not fine-grained visual discrimination) rather than a prompt-wording problem, though a stronger model tier wasn't tested. Practical effect: the `needs_review` bold-uncertainty path (`exactMatch.ts`'s `BOLD_UNCERTAIN_EXPLANATION`) is real, tested, correct code that in practice rarely if ever fires against real extraction output right now — accepted as a known limitation for this prototype rather than pursued further (e.g., swapping models for just this one signal), consistent with working-core-over-chasing-every-edge-case.
- **Relies on the Gemini API (cloud) for extraction; no local implementation built.** The `LabelExtractor` interface exists specifically so a self-hosted/local model could be substituted without touching matching logic or the API layer, but that substitution isn't built for this take-home — the ops/cost burden and lower accuracy of small open-weight vision models versus Gemini didn't justify it for a benefit (proving swappability) the clean interface already delivers.
- **Poor-quality images (bad angle, glare, low light) are not specifically handled.** Called out by a stakeholder as likely out of scope for a prototype.
- **No integration with the legacy COLA system, and the batch input format is an educated guess.** Standalone proof-of-concept only, per explicit scope from IT. The CSV-manifest-plus-filename-keyed-images shape is a reasonable stand-in reasoned from what a portable format would likely look like, not a researched fact about COLA's real data shape — worth stating as an acknowledged unknown in the write-up.
- **No authentication, and the batch-resume cookie is not an account.** No login, no password, no PII, no long-term identity — justified because no real, sensitive data is ever in this prototype, but also means an unauthenticated public demo URL has no protection against someone spamming verifications and running up API cost.
- **Batch wall-clock time is bounded by the concurrency cap and the provider's rate limit, not by this app's own design.** A 300-label batch is faster than sequential processing but not instantaneous; a low free-tier RPM ceiling means large batches take meaningfully longer than concurrency alone would suggest, disclosed via progress in the UI rather than hidden. Paying for a higher-tier plan is an accepted option if this proves too restrictive.
- **No coordination across different browsers' concurrent batches — by design, not oversight.** The anonymous-cookie/KV-keying scheme (see "Resuming across a browser restart") isolates *data* between browsers cleanly (two batches can never collide on the same KV keys), but the concurrency cap `N` is scoped to one batch's own processing round, not the whole app's aggregate load — nothing tracks or throttles how many `/api/batch/[id]/process` calls (and therefore how many extraction-provider requests) are in flight across every active batch at once. Two browsers each running their own batch at N=1 is two concurrent extraction calls against the same shared API key, not one. A production deployment serving many simultaneous agents would need a real request queue or global semaphore in front of the extraction calls; that's out of scope here because the stated use case is one agent working one batch (Sarah Chen's "200, 300 label applications... dump on us at once" describes one importer's batch size, not concurrent multi-agent load), and IT explicitly scoped this as a standalone prototype ("for a prototype? Just don't do anything crazy") rather than a production multi-tenant system. Paying for a higher-tier provider plan (see above) raises the ceiling before this becomes a practical problem, but does not add the missing coordination itself.
- **Free-tier rate limits and terms aren't guaranteed stable, and haven't been checked yet.** The specific RPM ceiling used to size the concurrency cap needs to be confirmed against current provider docs before implementation, not assumed from a point-in-time guess — an open action item.
- **Single-active-tab enforcement adds real complexity for a real reason.** Without it, two tabs on the same batch would silently race for the same rows; the lock mechanism (tab-scoped id + heartbeat) is small but is a genuine piece of machinery that didn't exist in the original client-only design.