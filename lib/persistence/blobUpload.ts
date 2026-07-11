// Client-upload helper for label images: uploads go directly from the browser to
// Vercel Blob using a short-lived signed client token, never through this app's own API
// request body — Vercel serverless functions have a request body size limit (~4.5MB) a
// 200-300 image batch would blow past immediately if images were routed through an API
// route the normal way.
//
// Two halves, split the same way @vercel/blob's own client-upload pattern splits them:
//   - uploadLabelImage()               — runs in the browser (BatchUploadPanel.tsx,
//                                          Phase 8): hands one File straight to Vercel
//                                          Blob, fetching its own upload token first.
//   - handleLabelImageUploadRequest()  — runs on the server: issues that short-lived
//                                          client token, restricted to this app's own
//                                          label-image pathname namespace and content
//                                          types, and is notified once each upload
//                                          actually finishes.
// Phase 7 still needs to add a Route Handler that calls handleLabelImageUploadRequest()
// and passes its handleUploadUrl (this file's default export
// LABEL_IMAGE_UPLOAD_HANDLER_PATH) to uploadLabelImage() — that route file itself isn't
// part of this phase's scope: none of the batch routes planned so far include a
// dedicated blob-token endpoint, so Phase 7 will need to add one, or fold this
// handshake into an existing batch route.

import { handleUpload, upload } from "@vercel/blob/client";
import type { HandleUploadBody } from "@vercel/blob/client";
import type { PutBlobResult } from "@vercel/blob";

/**
 * The one Route Handler path this app expects to wire up to
 * handleLabelImageUploadRequest() for the client-token handshake uploadLabelImage()
 * needs. Exported as a named constant (not hardcoded inline at each call site) so
 * Phase 7's route and Phase 8's upload calls can't silently drift apart on the path.
 */
export const LABEL_IMAGE_UPLOAD_HANDLER_PATH = "/api/batch/blob-upload";

/**
 * MIME types a label image upload is allowed to declare. Enforced server-side (inside
 * handleLabelImageUploadRequest()'s onBeforeGenerateToken, below) — a browser can't be
 * trusted to only ever request a token for an actual image, so this is where that
 * restriction is actually applied, not just assumed on the client.
 */
export const LABEL_IMAGE_ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/** Pathname prefix every label image is stored under, namespaced by batch. */
const LABEL_IMAGE_PATH_PREFIX = "batches";

/**
 * Builds the Blob store pathname a label image is uploaded/stored under, namespaced by
 * batch so two different batches (even two started by the same browser) never collide
 * on the same fileName, and so every image belonging to one batch shares a common
 * prefix. Pure string logic — no network call — so it's directly unit-testable, unlike
 * the two functions below it that actually talk to Vercel Blob.
 */
export function blobPathForLabelImage(batchId: string, fileName: string): string {
  return `${LABEL_IMAGE_PATH_PREFIX}/${batchId}/${fileName}`;
}

/**
 * Uploads one label image directly from the browser to Vercel Blob, bypassing this
 * app's own API routes entirely for the actual image bytes (see this file's header
 * comment for why). The only request that touches this app's own server is the brief
 * client-token exchange @vercel/blob's `upload()` makes internally against
 * `handleUploadUrl` — everything after that token is issued goes straight
 * browser-to-Blob. Returns the resulting Blob URL, to be recorded as this row's
 * `BatchRowState.blobRef` (kvStore.ts) once the batch is registered.
 */
export async function uploadLabelImage(
  file: File,
  params: { batchId: string; fileName: string; handleUploadUrl?: string }
): Promise<{ blobRef: string }> {
  const result: PutBlobResult = await upload(blobPathForLabelImage(params.batchId, params.fileName), file, {
    access: "public",
    handleUploadUrl: params.handleUploadUrl ?? LABEL_IMAGE_UPLOAD_HANDLER_PATH,
  });
  return { blobRef: result.url };
}

/**
 * Server-side half of the client-upload handshake: intended to be called from whatever
 * Route Handler Phase 7 wires up at LABEL_IMAGE_UPLOAD_HANDLER_PATH. Delegates the
 * actual protocol work to @vercel/blob's own `handleUpload()`, which has two jobs:
 *   1. Before the browser's real upload starts, issue it a short-lived client token —
 *      this is where that token gets restricted to this app's own label-image pathname
 *      namespace (`batches/...`) and allowed content types, rather than handing out an
 *      unrestricted token a browser could otherwise use to write anywhere in the store.
 *   2. Once the browser's upload actually finishes, receive a notification — kept as a
 *      no-op here rather than writing to KV from inside it: Phase 7's batch
 *      registration route already learns the final blobRef directly, from
 *      uploadLabelImage()'s own return value, so writing it again here would just be a
 *      second, redundant write path for the same information.
 * Propagates whatever handleUpload() throws (a malformed request body, a rejected
 * pathname) rather than swallowing it — the calling Route Handler owns turning that
 * into an HTTP error response, the same division of responsibility
 * app/api/verify/route.ts already uses around verify() (Phase 4).
 */
export function handleLabelImageUploadRequest(request: Request, body: HandleUploadBody): ReturnType<typeof handleUpload> {
  return handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      if (!pathname.startsWith(`${LABEL_IMAGE_PATH_PREFIX}/`)) {
        throw new Error(
          `Refusing to issue an upload token for a pathname outside the "${LABEL_IMAGE_PATH_PREFIX}/" namespace: ${pathname}`
        );
      }
      return {
        allowedContentTypes: LABEL_IMAGE_ALLOWED_CONTENT_TYPES,
        // Filenames are already namespaced by batch (blobPathForLabelImage) and paired
        // deterministically to CSV manifest rows by exact fileName — a random suffix
        // here would break that pairing, so overwriting the same pathname (a retried
        // upload for the same row) is allowed instead of silently renamed.
        addRandomSuffix: false,
        allowOverwrite: true,
      };
    },
  });
}
