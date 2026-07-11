// POST /api/batch/blob-upload — the server-side half of the direct-browser-to-Blob
// upload handshake for batch label images. This route exists purely as thin wiring: all
// the actual logic (which pathnames are allowed, which content types, whether an
// overwrite is permitted) already lives in the label-image upload helper this delegates
// to — the same thin-delegation shape single-verify's own API route already uses around
// its verification call, kept here instead of duplicated for two reasons: (1) the
// upload-token protocol this implements is entirely generic request/response plumbing
// with no verification-specific meaning, and (2) every restriction a browser's upload
// request actually gets checked against belongs in one place, not copied into whichever
// route happens to expose it.
//
// Without this file, the client-upload helper's own exported handler path points at a
// URL nothing serves — any attempt to upload a batch label image would fail outright
// before ever reaching Blob storage, since the client-side upload call always begins by
// asking this exact path for a token.

import { NextResponse } from "next/server";
import type { HandleUploadBody } from "@vercel/blob/client";
import { handleLabelImageUploadRequest } from "@/lib/persistence/blobUpload";

/**
 * Handles POST /api/batch/blob-upload. Typed to accept a plain Request (the Web
 * standard type), not the Next-specific NextRequest single-verify's own route uses —
 * nothing here reads anything Next-specific off the request (no cookies, no parsed
 * URL), and handleLabelImageUploadRequest() itself is already written against the plain
 * Request type, so there's no reason to narrow to a more specific type than either side
 * actually needs. This also keeps the handler directly callable with a plain
 * `new Request(...)` in tests, without needing to construct a full Next.js request object.
 *
 * The request body is one of two event shapes (defined by @vercel/blob's own
 * client-upload protocol, not by this app): a token-generation request, sent once
 * before a browser's upload actually starts, or an upload-completed notification, sent
 * once it finishes. This route's own job is just parsing that body and handing it to
 * handleLabelImageUploadRequest() — every actual decision (reject a pathname outside
 * this app's own label-image namespace, restrict which content types are accepted)
 * happens inside that function, not here. Whatever it throws (a rejected pathname being
 * the case this app cares about most) is turned into a 400 response rather than
 * swallowed, the same division of responsibility single-verify's route already uses
 * around its own call into shared logic.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const responseBody = await handleLabelImageUploadRequest(request, body);
    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blob upload token request failed for an unknown reason.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
