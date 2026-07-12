# Approach, Tools, and Assumptions

See [README.md](README.md) for setup and run instructions. This document is the brief
documentation of approach, tools used, and assumptions made.

## Approach

- **Two flows, one tool.** Single-verify (`POST /api/verify`) is fully stateless — one
  image and one application in, one result out, nothing persisted. Batch verification
  adds a minimal, ephemeral, TTL'd (~48h) server-side store (an anonymous cookie + KV for
  progress + Blob for images) purely so a browser refresh or crash mid-batch doesn't lose
  progress on a 200-300 label run — not a database, no accounts, no durable history.

- **Extraction is value-guided, not blind transcription.** The model (Gemini
  `gemini-3.1-flash-lite`, called directly via its REST API) is given each field's name
  *and* the application's expected value as a search hint, because real labels aren't
  headed like form fields ("Brand Name:", "ABV:") the way a naive transcription approach
  would assume.

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

- **The application's field set is open, never hardcoded.** Any column in a batch
  manifest, or any field submitted through the single-verify form, gets checked — an
  unrecognized field defaults to the model's own judgment rather than being silently
  dropped. Brand name, class/type, producer, and country of origin all fall into this
  open/fuzzy category alongside anything not explicitly named.

- **Batch processing is server-driven and chunked**, paced to the extraction provider's
  rate limit: a browser with an open tab repeatedly asks the server to process a few
  pending rows (`POST /api/batch/[id]/process`), not a client-side concurrency pool and
  not an unattended background job — nothing processes while no tab is watching. A
  single-active-tab lock (a tab-scoped id plus a heartbeat, both in KV) stops two tabs on
  the same batch from racing each other for the same rows; closing a tab proactively
  releases its lock via `navigator.sendBeacon` on page unload, falling back to a
  heartbeat-staleness timeout for a genuine crash where no unload event fires at all.

- **Results outlive the ephemeral store by becoming a file, not a record.** A batch's
  results are downloadable as a CSV in the same shape as the input manifest, plus
  `status` and `flaggedFields` columns — this is how the deliberately non-durable storage
  design gets mitigated: by handing the agent a record they control, not by the tool
  keeping one.

## Results

Every checked field is reported as one of three statuses — **matched**, **mismatched**,
or **needs_review** — alongside what the application said (`applicationValue`) and what
was actually found on the label (`extractedValue`). A field that's flagged (anything
other than matched) also carries an `explanation`: for the open/fuzzy fields (brand
name, class/type, producer, country of origin, or anything unrecognized), that's the
model's own stated reasoning from the same extraction call; for the Government
Warning's one ambiguous case — text and ALL CAPS both correct, only the bold styling in
question — it's a fixed, code-owned message, not model-generated, since the
application/label text alone would look identical in that case and wouldn't explain why
it was flagged.

A label's overall result rolls up from its individual fields by simple precedence: any
`mismatched` field makes the whole label `mismatched`; otherwise any `needs_review`
field makes it `needs_review`; a label is only reported `matched` if every field it was
checked against matched cleanly. `needs_review` is a flag for a human to look at, not a
decision the tool makes on its own — there's no approve/reject workflow, since the
actual resolution happens outside this tool.

For a batch, this same per-label information is what the downloadable results CSV
carries: the original manifest columns unchanged, plus a `status` column (the rollup)
and a `flaggedFields` column — populated only when `status` isn't `matched`, one entry
per flagged field, `"; "`-joined, each written as `fieldName (label says <what was
found>)` or `fieldName (<explanation>)` when the field carries one.

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
  (a strengthened prompt made no measurable difference).
- **Poor-quality images (bad angle, glare, low light) aren't specifically handled.**
  Called out as likely out of scope for a prototype.