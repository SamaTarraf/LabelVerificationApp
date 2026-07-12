# Label Verification App

An AI-assisted tool for TTB compliance agents: upload a photo of an alcohol beverage
label plus the details from its application, and it checks whether the label actually
matches the application — brand name, class/type, alcohol content, net contents,
producer, country of origin, and the Government Warning statement — flagging anything
that doesn't. Supports both a single-label check and a batch flow (a CSV manifest plus
many label images at once).

**Live URL:** https://nextjs-boilerplate-virid-kappa-78.vercel.app/

See [DOCUMENTATION.md](Documentation/DOCUMENTATION.md) for the approach, tools used, and assumptions made.

---

## Setup & Run

### Prerequisites

- Node.js 20+ and npm
- A [Google Gemini API key](https://aistudio.google.com/apikey) (free tier works)
- For the **batch flow only** — a Vercel account with a KV (Redis) store and a Blob
  store (see [Batch flow storage setup](#batch-flow-storage-setup) below). The
  single-verify flow needs only the Gemini key.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Then fill in `.env.local`:

| Variable | Required for | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Everything | Get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). No fallback — the app throws immediately if unset. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Batch flow only | See [Batch flow storage setup](#batch-flow-storage-setup). |
| `BLOB_READ_WRITE_TOKEN` | Batch flow only | See [Batch flow storage setup](#batch-flow-storage-setup). |
| `BATCH_PROCESS_CONCURRENCY` | Optional | How many pending rows one batch-processing call verifies in parallel. Defaults to `1` (sized for Gemini's free-tier rate limit — see [Assumptions & Known Limitations](DOCUMENTATION.md#assumptions--known-limitations)). Raise it if you're on a paid Gemini tier with real rate-limit headroom. |
| `NEXT_PUBLIC_MAX_BATCH_SIZE` | Optional | Maximum matched rows a single batch may contain. Defaults to `500`. |

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The single-verify form works with
just `GEMINI_API_KEY` set; the batch section will error on submit if the KV/Blob
variables aren't configured.

#### Understanding a result

Every checked field shows what the application said next to what was actually found on
the label, plus one of three statuses:

- **Matched** — the label agrees with the application.
- **Mismatched** — the label clearly disagrees (e.g. a different ABV, a Government
  Warning that isn't in ALL CAPS).
- **Needs Review** — genuinely ambiguous, not a clear pass or fail (e.g. the model isn't
  confident about a visual detail, or a brand name looks like a minor formatting
  variant rather than a real mismatch). This is a flag for a human to look at, not a
  decision the tool makes on its own.

A flagged field also carries a short explanation of *why* it was flagged. The overall
result for a label rolls up from its fields: any mismatched field makes the whole label
mismatched; otherwise any needs-review field makes it needs-review; only a label with
every field matched is reported as matched. In the batch flow, this same information is
what gets exported to the results CSV as `status` and `flaggedFields`.

### 4. Run tests

```bash
npm test
```

Runs the full Vitest suite (pure domain logic — parsers, matchers, CSV export, request
validation, etc.). API routes, live model calls, and browser-only behavior (file
uploads, `sessionStorage`) are not covered by automated tests — exercised manually and
via live end-to-end runs against real Gemini/KV/Blob credentials during development
instead.

### 5. Type-check and lint

```bash
npx tsc --noEmit
npm run lint
```

### 6. Production build

```bash
npm run build
npm start
```

---

## Batch flow storage setup

The batch flow needs a Redis-compatible key-value store and a blob store. Both are
provisioned through Vercel's **Storage** tab on your project:

1. **KV (Redis)**: Storage → Browse Marketplace → search "Redis" → install **Upstash for
   Redis**. Its `.env.local` tab (or `vercel env pull .env.local`) gives you
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
2. **Blob**: Storage → Create Database → **Blob**. Set access to **Public** — the app's
   upload code requests `access: "public"` and reads images back with a plain
   unauthenticated fetch, consistent with this being a prototype with no sensitive data.
   Its `.env.local` tab gives you `BLOB_READ_WRITE_TOKEN`.

For a deployed instance, set the same variables under the Vercel project's **Settings →
Environment Variables** — `.env.local` is gitignored and never deploys with the app.

---

See [DOCUMENTATION.md](Documentation/DOCUMENTATION.md) for the approach, tools used, and assumptions made.
