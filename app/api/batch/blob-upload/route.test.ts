// Vitest coverage for POST /api/batch/blob-upload — unlike the other three batch
// routes, this one is exercised with a real call into its underlying upload-token
// logic, not just a pure-logic extraction, because the pathname-namespace restriction
// this route is responsible for wiring up runs entirely locally: token-generation
// requests are validated and signed with plain HMAC before any network call to Blob
// storage would ever happen, so this suite can confirm the real rejection/acceptance
// behavior without live Blob credentials. A syntactically well-formed but entirely fake
// read-write token (never a real one) is enough to exercise this — it only ever needs
// to look like a token, never authenticate against anything.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

describe("POST /api/batch/blob-upload", () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_teststoreid_testsecret";
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    } else {
      process.env.BLOB_READ_WRITE_TOKEN = originalToken;
    }
  });

  /** Builds a fake "generate a client token" request, the same shape @vercel/blob's own client-side upload() call sends before it starts uploading. */
  function buildTokenRequest(pathname: string): Request {
    return new Request("http://localhost/api/batch/blob-upload", {
      method: "POST",
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: { pathname, multipart: false, clientPayload: null },
      }),
    });
  }

  it("resolves (not a 404) and rejects a token request for a pathname outside the batches/ namespace", async () => {
    const response = await POST(buildTokenRequest("not-batches/sneaky.jpg"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("batches/");
  });

  it("issues a client token for a pathname inside the batches/ namespace", async () => {
    const response = await POST(buildTokenRequest("batches/batch-1/IMG_001.jpg"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.type).toBe("blob.generate-client-token");
    expect(typeof body.clientToken).toBe("string");
    expect(body.clientToken.length).toBeGreaterThan(0);
  });

  it("returns a 400 rather than throwing when the request body isn't valid JSON", async () => {
    const malformedRequest = new Request("http://localhost/api/batch/blob-upload", {
      method: "POST",
      body: "not json",
    });

    const response = await POST(malformedRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("JSON");
  });
});
