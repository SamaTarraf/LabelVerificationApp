// POST /api/verify — one image + one application JSON in, one VerificationResult out.
// Fully stateless: nothing persisted, unchanged by the batch persistence work.
//
// Request shape: multipart/form-data with two parts —
//   "image"           — the label photo, as a File
//   "applicationData" — a JSON-encoded ApplicationData object, as a plain string field
// Multipart is used (not a single JSON body with a base64 image field) so the browser
// can hand the raw File object straight through in a FormData (see UploadForm.tsx),
// without an extra base64-encoding pass on the client before the request is even sent —
// the one base64 conversion this flow needs happens once, here, right before the image
// is handed to the extractor (the interface that actually requires base64).
//
// Response shape: the VerificationResult JSON on success (200), or `{ error: string }`
// on failure (4xx for a malformed request, 500 for anything that went wrong while
// actually verifying) — never a partial or misleadingly-shaped success response.

import { NextRequest, NextResponse } from "next/server";
import type { ApplicationData } from "@/lib/types";
import type { LabelImage } from "@/lib/extraction/types";
import { verify } from "@/lib/matching/verify";

/**
 * Vercel serverless function timeout for this route, in seconds. Set explicitly rather
 * than left at the platform default: 8s gives ample buffer over the ~1.7-2.2s real
 * Gemini latency measured in the Phase 0 spike (plus upload/matching/response
 * overhead), while still failing fast rather than hanging indefinitely on a stuck call
 * — and cutting the function off before it burns Gemini rate-limit quota on a request
 * nobody's still waiting for. Deliberately shorter than UploadForm.tsx's ~10s
 * client-side abort, so the browser never gives up on a server call that's still on
 * track to finish in time.
 */
export const maxDuration = 8;

/**
 * Type guard confirming a parsed JSON value is shaped like an ApplicationData object —
 * a plain, non-array object whose present values are all strings — before it's trusted
 * as one. The request body is an external system boundary, so this gets validated
 * rather than cast blindly (Golden Principle #6).
 */
function isApplicationData(value: unknown): value is ApplicationData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((fieldValue) => typeof fieldValue === "string" || fieldValue === undefined);
}

/**
 * Handles POST /api/verify. This handler's own job is request/response plumbing and
 * input validation only — it does not duplicate any extraction or matching logic
 * itself. The flow:
 *   1. Parse the multipart body and pull out the image file + applicationData JSON.
 *   2. Validate both parts (missing/wrong-typed image, missing/invalid-JSON/wrong-shaped
 *      applicationData) and fail fast with a 400 and a specific message if either is bad.
 *   3. Convert the uploaded File into the base64 + mimeType shape LabelExtractor expects.
 *   4. Delegate the actual verification to verify() (extraction + matching, already
 *      wired together in lib/matching/verify.ts) and return its result.
 *   5. Nothing is written to disk, a database, or any cache at any point — the function
 *      returns and there is no server-side trace of this request left behind.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Request body must be multipart/form-data." }, { status: 400 });
  }

  const imageEntry = formData.get("image");
  if (!(imageEntry instanceof File)) {
    return NextResponse.json({ error: 'Missing or invalid "image" file field.' }, { status: 400 });
  }

  const applicationDataEntry = formData.get("applicationData");
  if (typeof applicationDataEntry !== "string") {
    return NextResponse.json(
      { error: 'Missing "applicationData" field (expected a JSON string).' },
      { status: 400 }
    );
  }

  let parsedApplicationData: unknown;
  try {
    parsedApplicationData = JSON.parse(applicationDataEntry);
  } catch {
    return NextResponse.json({ error: '"applicationData" field was not valid JSON.' }, { status: 400 });
  }

  if (!isApplicationData(parsedApplicationData)) {
    return NextResponse.json(
      { error: '"applicationData" must be an object of string field values.' },
      { status: 400 }
    );
  }

  // Convert the uploaded File into the base64 + mimeType shape LabelExtractor's
  // interface expects — Gemini's inlineData request part needs base64 bytes, not a
  // File/Blob object, and this is the one place in the whole request/response flow
  // that conversion needs to happen.
  const imageArrayBuffer = await imageEntry.arrayBuffer();
  const image: LabelImage = {
    base64: Buffer.from(imageArrayBuffer).toString("base64"),
    mimeType: imageEntry.type || "application/octet-stream",
  };

  try {
    const result = await verify(imageEntry.name, image, parsedApplicationData);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    // Everything from here down is either the extractor's own thrown error (missing
    // API key, malformed Gemini response, network failure) or something unexpected —
    // either way, nothing has been persisted, so returning an error response is the
    // entire cleanup needed. The error message is safe to surface: geminiExtractor.ts's
    // thrown messages never include the API key or any other secret.
    const message = error instanceof Error ? error.message : "Verification failed for an unknown reason.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
