// Anonymous batch-owner id: read the existing one from a request's Cookie header, or
// issue a fresh one if none is present. This is the one piece of "identity" the batch
// flow has — an opaque, randomly-generated id that scopes a browser's batch/row state
// in KV, never a login/account: no accounts/auth, no password, no PII.
//
// Deliberately framework-agnostic: every function here operates on raw header strings,
// not NextRequest/NextResponse types, so this stays directly unit-testable without
// mocking Next.js's runtime, and stays swappable if the hosting framework ever changes.
// A Route Handler (Phase 7) wires this up by reading request.headers.get("cookie") and
// setting the returned Set-Cookie header value on its response.

/** Cookie name used to carry the anonymous batch-owner id. */
export const BATCH_OWNER_COOKIE_NAME = "batchOwnerId";

/**
 * How long the cookie lives in the browser, in seconds (~48h). Matches
 * kvStore.ts's BATCH_TTL_SECONDS exactly — there's no reason for the cookie pointing at
 * a batch record to outlive that record, or to expire before it and orphan an
 * otherwise-still-resumable batch.
 */
export const BATCH_OWNER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 48;

/**
 * Parses a raw `Cookie` request header ("name1=value1; name2=value2") into a
 * name -> value lookup. Returns an empty object for a missing/empty header rather than
 * throwing — "no cookies sent yet" is an entirely normal, expected case (e.g. a brand
 * new browser about to start its first batch), not an error condition.
 */
function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  // Cookie headers are a single "; "-separated line, each pair itself separated by the
  // *first* "=" only (a cookie's value is allowed to contain further "=" characters,
  // e.g. base64-ish tokens, so splitting on every "=" would corrupt those values).
  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      continue; // Malformed pair with no "=" — skip it rather than throw on an untrusted header.
    }
    const name = pair.slice(0, separatorIndex).trim();
    const rawValue = pair.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      // Not actually URI-encoded (or malformed encoding) — fall back to the raw value
      // rather than dropping the cookie entirely over a decoding quirk.
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

/**
 * Reads the anonymous batch-owner id out of a request's raw `Cookie` header, or
 * generates a brand-new one if the cookie wasn't sent (e.g. this browser's first-ever
 * batch, or its previous cookie already expired/was cleared). The generated id is a
 * random UUID — opaque, carrying no PII and no meaning beyond "this looks like the same
 * browser as before".
 * `isNew` tells the caller whether a Set-Cookie header actually needs to go back on the
 * response — an id that was already present on the request doesn't need to be
 * re-issued, only reused for the KV lookups this request needs.
 */
export function readOrIssueOwnerId(cookieHeader: string | null | undefined): { ownerId: string; isNew: boolean } {
  const existingOwnerId = parseCookieHeader(cookieHeader)[BATCH_OWNER_COOKIE_NAME];
  if (existingOwnerId) {
    return { ownerId: existingOwnerId, isNew: false };
  }
  return { ownerId: crypto.randomUUID(), isNew: true };
}

/**
 * Builds the `Set-Cookie` header value for handing a newly-issued owner id back to the
 * browser. Attribute choices, each deliberate:
 * - `HttpOnly` — this id is only ever read server-side (for KV lookups); client-side JS
 *   never needs it, so it's kept unreadable to any script running on the page.
 * - `Secure` — only ever sent back over HTTPS. Modern browsers treat `localhost` as a
 *   secure context regardless of scheme, so this doesn't break local `npm run dev`.
 * - `SameSite=Lax` — sent on this app's own same-site requests (including normal
 *   top-level navigation), without opening the door to the cross-site request forgery
 *   risk `SameSite=None` would.
 * - `Path=/` — valid across the whole app, not just one route, since both the
 *   single-verify and batch pages may need to read/renew it.
 */
export function buildOwnerCookieHeader(ownerId: string): string {
  const attributes = [
    `${BATCH_OWNER_COOKIE_NAME}=${encodeURIComponent(ownerId)}`,
    "Path=/",
    `Max-Age=${BATCH_OWNER_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  return attributes.join("; ");
}
