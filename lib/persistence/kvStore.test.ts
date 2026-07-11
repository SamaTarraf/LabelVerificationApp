// Vitest coverage for kvStore.ts's key-naming/namespacing logic only — the pure string
// functions that decide what a batch record, a row's state, and an owner's
// current-batch pointer are actually called as keys in KV. The functions that call the
// real @vercel/kv client (writeBatchRecord, readBatchRowState, etc.) are not covered
// here, per this project's established testing-scope convention (pure logic gets
// automated tests, direct external API calls don't — see this file's header comment).

import { describe, expect, it } from "vitest";
import { batchRecordKey, batchRowKey, ownerCurrentBatchKey } from "./kvStore";

describe("batchRecordKey", () => {
  it("namespaces a batch record under its own batch id", () => {
    expect(batchRecordKey("batch-123")).toBe("batch:batch-123");
  });
});

describe("batchRowKey", () => {
  it("namespaces a row's state under both its batch id and fileName", () => {
    expect(batchRowKey("batch-123", "IMG_001.jpg")).toBe("batch:batch-123:row:IMG_001.jpg");
  });

  it("URI-encodes a fileName containing a colon so it can't collide with the key's own separators", () => {
    // A fileName like "weird:name.jpg" would otherwise introduce an extra ":" into the
    // key, indistinguishable from the key format's own structural separators.
    expect(batchRowKey("batch-123", "weird:name.jpg")).toBe("batch:batch-123:row:weird%3Aname.jpg");
  });

  it("produces different keys for the same fileName across two different batches", () => {
    const keyInFirstBatch = batchRowKey("batch-1", "IMG_001.jpg");
    const keyInSecondBatch = batchRowKey("batch-2", "IMG_001.jpg");

    expect(keyInFirstBatch).not.toBe(keyInSecondBatch);
  });
});

describe("ownerCurrentBatchKey", () => {
  it("namespaces the owner-to-current-batch pointer under the owner cookie value", () => {
    expect(ownerCurrentBatchKey("owner-abc-123")).toBe("owner:owner-abc-123:currentBatch");
  });
});
