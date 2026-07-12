// Vitest coverage for types.ts's one runtime piece of logic: the batch-size-cap
// resolver. Pure, env-var-driven, no I/O — same testing-scope convention as
// resolveBatchProcessConcurrency() in app/api/batch/[id]/process/route.ts, which this
// file's test cases deliberately mirror.

import { describe, expect, it, afterEach } from "vitest";
import { resolveMaxBatchSize } from "./types";

describe("resolveMaxBatchSize", () => {
  const originalValue = process.env.NEXT_PUBLIC_MAX_BATCH_SIZE;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.NEXT_PUBLIC_MAX_BATCH_SIZE;
    } else {
      process.env.NEXT_PUBLIC_MAX_BATCH_SIZE = originalValue;
    }
  });

  it("defaults to 500 when the environment variable isn't set at all", () => {
    delete process.env.NEXT_PUBLIC_MAX_BATCH_SIZE;
    expect(resolveMaxBatchSize()).toBe(500);
  });

  it("reads a positive integer straight from the environment variable", () => {
    process.env.NEXT_PUBLIC_MAX_BATCH_SIZE = "1000";
    expect(resolveMaxBatchSize()).toBe(1000);
  });

  it("floors a non-integer value rather than rejecting it outright", () => {
    process.env.NEXT_PUBLIC_MAX_BATCH_SIZE = "250.9";
    expect(resolveMaxBatchSize()).toBe(250);
  });

  it("falls back to 500 when the value isn't a usable number", () => {
    process.env.NEXT_PUBLIC_MAX_BATCH_SIZE = "not-a-number";
    expect(resolveMaxBatchSize()).toBe(500);
  });

  it("falls back to 500 when the value is zero or negative (a cap of 0 makes no sense)", () => {
    process.env.NEXT_PUBLIC_MAX_BATCH_SIZE = "0";
    expect(resolveMaxBatchSize()).toBe(500);

    process.env.NEXT_PUBLIC_MAX_BATCH_SIZE = "-10";
    expect(resolveMaxBatchSize()).toBe(500);
  });
});
