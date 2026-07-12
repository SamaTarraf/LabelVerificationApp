# Approach, Tools, and Assumptions

See [README.md](README.md) for setup and run instructions. This document is the brief
documentation of approach, tools used, and assumptions made.

## Approach

- **Two flows, one tool.** Single-verify (`POST /api/verify`) is fully stateless — one
  image and one application in, one result out, nothing persisted. Batch verification
  adds a minimal, ephemeral, TTL'd (~48h) server-side store (an anonymous cookie + KV for
  progress + Blob for images) purely so a browser refresh or crash mid-batch doesn't lose
  progress on a 200-300 label run — not a database, no accounts, no durable history.

- **The UI is designed against a first-time, low-tech-comfort user, not a power user.**
  Stakeholder interviews set an explicit usability bar — "clean, obvious, no hunting for
  buttons," benchmarked against a 73-year-old first-time user — so the single page
  (`app/page.tsx`) keeps both flows visible as two clearly labeled, always-present
  sections rather than tabs that hide one behind a click. The single-verify section is a
  native `<details>`/`<summary>` disclosure (closed by default) so its longer form
  doesn't push the batch section out of view, while its heading stays visible either way.
  No flow requires knowing the other exists first.

- **Extraction is value-guided, not blind transcription.** The model (Gemini
  `gemini-3.1-flash-lite`, called directly via its REST API) is given each field's name
  *and* the application's expected value as a search hint, because real labels aren't
  headed like form fields ("Brand Name:", "ABV:") the way a naive transcription approach
  would assume. `flash-lite` specifically (over the plain `flash` tier) was chosen for
  its lower latency — a deliberate speed-over-capability trade-off, not the only viable
  option (see the latency bullet below for the actual bar this was measured against).

- **Matching is split between algorithmic and model-judged, deliberately.** The
  Government Warning stays fully algorithmic and deterministic: exact word-for-word body
  match (case-insensitive), a hard case-*sensitive* check that the "GOVERNMENT WARNING:"
  prefix is in literal ALL CAPS on the label, and a best-effort visual bold-styling
  signal that only ever upgrades a result to `matched` on a confident "yes" — anything
  else defers to `needs_review`, never a silent pass. Every other field — including
  Alcohol Content and Net Contents — is judged directly by the model during the same
  extraction call, with explicit prompt instructions enforcing **exact numeric equality**
  (no rounding tolerance) for both, and for Net Contents specifically: same-system metric
  unit conversion is treated as a match (`750 mL` = `0.75 L`), but cross-system
  conversion (metric ↔ imperial, e.g. mL to fl oz) is never treated as equal even when
  the underlying volume matches.

- **Every field gets a three-way verdict, not a bare pass/fail** — `matched`,
  `mismatched`, or `needs_review` — alongside what the application said
  (`applicationValue`) and what was actually found on the label (`extractedValue`). A
  flagged field also carries an `explanation`: the model's own stated reasoning for
  fuzzy fields, or a fixed, code-owned message for the Government Warning's
  bold-uncertain case specifically (since the application/label text alone would look
  identical there — only the styling is in question). A label's overall result rolls up
  from its fields by simple precedence: any `mismatched` field wins, otherwise any
  `needs_review` field does, and only a label with everything matched is reported
  `matched`. `needs_review` is a flag for a human to look at, not a decision the tool
  makes on its own.

- **The application's field set is open, never hardcoded.** Any column in a batch
  manifest, or any field submitted through the single-verify form, gets checked — an
  unrecognized field defaults to the model's own judgment rather than being silently
  dropped. Brand name, class/type, producer, and country of origin all fall into this
  open/fuzzy category alongside anything not explicitly named.

- **Batch processing is server-driven and chunked.** A browser with an open tab
  repeatedly asks the server to process a few pending rows at a time
  (`POST /api/batch/[id]/process`) — not a client-side concurrency pool, not an
  unattended background job. A single-active-tab lock (a tab id + heartbeat in KV)
  stops two tabs on the same batch from racing each other; closing a tab releases the
  lock right away via `navigator.sendBeacon`, with a heartbeat-staleness fallback for a
  genuine crash. Each call processes a fixed group of `N` rows together and waits for
  all `N` before the next call starts — so one slow row holds up the other, already-
  finished slots instead of letting them move on immediately. Future improvement: a
  real queue that refills a slot the moment it finishes, instead of waiting for the
  whole group. `N=5` was validated with real, live runs (50-200 row batches, not just
  rate-limit math) — see Assumptions & Known Limitations for the actual results.

- **Results outlive the ephemeral store by becoming a file, not a record.** A batch's
  results are downloadable as a CSV in the same shape as the input manifest, plus
  `status` and `flaggedFields` columns — this is how the deliberately non-durable storage
  design gets mitigated: by handing the agent a record they control, not by the tool
  keeping one. `flaggedFields` is populated only when `status` isn't `matched`, one entry
  per flagged field, `"; "`-joined, written as `fieldName (label says <what was found>)`
  or `fieldName (<explanation>)` when the field carries one.

- **A stuck request is handled by Vercel's own `maxDuration` limit** (8s on
  `POST /api/verify`, 20s on `POST /api/batch/[id]/process`, 30s on `POST /api/batch`),
  not a code-level timeout on the Gemini call itself — deliberate, to fail fast rather
  than hang indefinitely and to stop the function from burning Gemini rate-limit quota
  on a request nobody's still waiting for. Because Vercel kills the whole function from
  outside, the route's own `try`/`catch` never runs and never gets to shape a clean
  response; single-verify just falls back to a generic HTTP-status message with a Retry
  button (nothing was persisted, so a timeout costs nothing). Batch degrades more
  gracefully, but incidentally: the `"in_flight"` → `"done"` KV pattern each row already
  goes through was built for crash recovery, not for this specifically — but a
  `maxDuration` kill and a real crash look identical from inside the code, so rows
  already finished that round keep their result, and only the row still in flight when
  the kill happened needs a retry (automatic, on the batch's next processed round).

- **The 5-second single-verify response bar comes directly from a stakeholder story**:
  a prior scanning-vendor pilot took 30-40 seconds per label, and agents abandoned it
  for manual review rather than wait. Meeting that bar was a hard input to the model-tier
  choice, not an afterthought — `gemini-3.1-flash-lite`'s real per-call latency
  (~1.7-2.2s, measured against the live API before being relied on) leaves comfortable
  headroom under 5s even with network and image-upload overhead on top; the 8s
  `maxDuration` above is a backstop for a stuck request, not the target. The round-trip
  time is measured and shown back to the agent on every result ("Verified in X.Xs" in
  `ResultsTable.tsx`), so the 5-second promise is something visibly confirmed each time,
  not just a claim in this document.

## Tools Used

- **Claude Code**, used throughout the development process: brainstorming the
  architecture and weighing technical/design choices (e.g. stateless-vs-persisted,
  algorithmic-vs-model-judged matching, the batch storage design) before any code was
  written, then a written plan derived from those decisions, then implementation phase
  by phase against that plan — each phase's code paired with its own tests and, where a
  live external dependency (Gemini, KV, Blob) was involved, a real end-to-end run
  against actual credentials rather than mocks alone.
- **Next.js (App Router) + TypeScript**, deployed to Vercel
- **Google Gemini API** (`gemini-3.1-flash-lite`) — the only extraction integration, called
  directly via `fetch` against its REST endpoint (no SDK dependency for a single call
  shape)
- **Vercel KV** (Redis, via the Upstash Marketplace integration) — ephemeral batch/row
  progress, every write carrying a TTL
- **Vercel Blob** — direct browser-to-storage upload for batch label images, bypassing
  the app's own API routes entirely so a 200-300 image batch never hits Vercel's
  serverless request-body size limit (~4.5MB)
- **Vitest** — unit tests for pure domain logic (CSV/manifest parsing, matchers, rollup
  logic, CSV export, request validation); everything that requires a live network call
  (Gemini, KV, Blob) is validated by direct live calls during development and by code
  inspection, not mocked into an automated suite
- **Playwright** — development-only tooling (not part of the shipped app) used to
  generate synthetic label images and drive real end-to-end tests against the live batch
  pipeline (registration → chunked processing → resume → CSV export) with real Gemini/KV/
  Blob credentials

## Assumptions & Known Limitations

**Explicitly acknowledged unknowns** (the take-home brief asks for these to be stated,
not silently assumed):

1. **The CSV-manifest-plus-filename-keyed-images batch format is an assumed format.** There's no integration with the real legacy COLA system, and its
   actual data/import format is unknown — this shape (one CSV row per label, paired to
   an uploaded image by an exact `fileName` column, with a separate free-form `id`
   column) was reasoned from what a portable format would plausibly look like for an
   agent or importer to download and re-upload elsewhere, not verified against COLA
   itself.
2. **No local or self-hosted extraction model was built.** The `LabelExtractor`
   interface exists specifically so a self-hosted/local model could be substituted
   later without touching matching logic or the API layer, but that substitution isn't
   built here — running a self-hosted vision model needs GPU compute that's
   provisioned, kept running, and paid for continuously, which wasn't readily
   accessible for this project, versus Gemini's pay-per-call API with no infrastructure
   to stand up at all. That cost/access gap didn't justify it for a benefit (proving
   swappability) the clean interface already delivers on its own.

   This is a deliberate prototype-scope call, not an oversight: IT's interview describes
   a production network that blocks outbound traffic to a lot of domains (and a prior
   vendor pilot that lost features to exactly that), but the same interview draws a clear
   line for this exercise — "for a prototype? Just don't do anything crazy." This build
   takes that at face value and assumes open outbound access, which holds for both local
   dev and the Vercel deployment used here. The swappable `LabelExtractor` interface is
   what would let a future, network-isolated deployment substitute a local model without
   touching matching logic or the API layer — but building that substitution now would be
   solving a production constraint this prototype was explicitly told it doesn't have to.
3. **Applications are assumed valid.** The tool checks label-vs-application
   consistency, not independent TTB regulatory compliance — a field absent from the
   application isn't checked on the label at all, and a value the application states
   incorrectly (e.g. an out-of-date Government Warning wording, or a class/type that
   isn't actually a valid TTB designation) is trusted as the target to match against,
   not verified against TTB's own regulations itself.

**Other trade-offs, stated plainly:**

- **Batch persistence survives a refresh or crash, not a wiped browser or a different
  device.** The anonymous cookie identifying a browser's batch is exactly as fragile as
  any other browser storage to "clear browsing data" — this isn't a cross-device or
  cross-browser solution, and everything is TTL'd (~48h), scoped to one active/most
  recent batch per cookie.
- **No authentication.** There's no login, no password, and no personal data collected
  anywhere — the batch-resume cookie is an anonymous claim-check ("this is the same
  browser as before"), not an account. That's a reasonable call for a prototype
  handling no sensitive data, but it's a real trade-off worth naming: a deployed URL
  with no auth in front of it has no protection against someone spamming verifications
  and running up API cost.
- **Fuzzy-field judgment (brand name, class/type, producer, country of origin) is
  model-based, not deterministic.** Combined with giving the model the application's
  expected value as a search hint, there's an accepted anchoring-bias risk for this
  category — mitigated by keeping the Government Warning's decision fully algorithmic
  and untouched by that risk.
- **The Government Warning's bold-styling signal skews toward always-confident in
  testing, not genuinely discriminating.** Six synthetic label variants spanning a wide
  range of font weights (including one with `getComputedStyle`-confirmed non-bold
  styling) all came back reported as confidently bold. The underlying code path is
  correct — an unconfident or negative answer defers to `needs_review` rather than being
  trusted or ignored — but in practice this specific visual signal rarely if ever
  triggers that path with the current model tier. Most likely a genuine capability limit
  of the fast/lightweight model chosen for latency, not a prompt-wording problem
  (a strengthened prompt made no measurable difference). A plausible next step, not yet
  tried: switching this one call to the plain `flash` tier (or a different model
  entirely) — trading some latency for potentially real bold-detection capability —
  since the speed/capability trade-off that justified `flash-lite` project-wide may not
  hold for this one narrow, visually-subtle sub-task specifically.
- **Poor-quality images (bad angle, glare, low light) aren't specifically handled.**
  Called out as likely out of scope for a prototype.
- **Blob-stored label images are deleted manually, not automatically.** Unlike KV,
  which TTLs every write (~48h), nothing in the codebase currently deletes a batch's
  uploaded images — they need to be cleared out by hand. Additional code could automate
  this instead (e.g. deleting a batch's images once it completes).
- **`lib/matching/numericMatch.ts` and `unitMatch.ts` (Alcohol Content and Net Contents'
  original algorithmic matchers) exist in the codebase but aren't currently used.**
  `fieldMatchers.ts` no longer dispatches to them — both fields are model-judged now
  (see Approach above). They're kept as dormant, tested code, not deleted, as the
  re-enablement path if algorithmic precision on these two fields gets added back later.
  They'd likely need real improvement before that re-enablement is worth doing, though:
  `unitMatch.ts` requires exact unit-string equality with no conversion at all, so it
  would flag `"750 mL"` vs `"0.75 L"` as a mismatch — stricter than the current
  model-judged behavior, which explicitly allows same-system metric conversion.
  Re-enabling these as-is would be a regression, not a neutral swap back to determinism.
- **Batch scale testing surfaced two different failure behaviors for a failed row, not
  one consistent pattern.** Live runs against a paid Gemini tier at `N=5`: 50- and
  150-row batches completed cleanly in ~20s and ~1 min with no errors; a 200-row batch
  (~1 min 30s) had one row error that self-healed automatically on the very next round,
  exactly as the retryable-row design intends; a 100-row batch (~1 min) had four rows
  error, and even after a manual resume those four never completed — they stayed stuck
  at "waiting" and the run ended without them. The 100-row failure's root cause wasn't
  individually diagnosed (rate limiting, a slow Blob fetch, and a malformed extraction
  response are all plausible, untested candidates); a same-size reproduction attempt
  afterward completed 100/100 with zero errors, pointing toward something transient
  rather than a deterministic bug, but that's one clean counter-run, not proof.
- **A row that never finishes is silently missing from the CSV export, though not from
  the on-page table.** `resultsToCsv()` only includes rows with `status === "done"`, so
  an unfinished batch's export just has fewer rows than the manifest, with nothing in
  the file itself flagging that. The on-page batch table does correctly show "waiting"
  for stuck rows — the gap is specifically in the export, not the UI generally. At
  minimum the export should mark unfinished rows rather than omit them silently.
