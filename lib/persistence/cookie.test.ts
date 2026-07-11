// Vitest coverage for cookie.ts: the anonymous batch-owner id lookup/issuance and the
// Set-Cookie header it hands back. Pure string-in/string-out logic — no Next.js runtime,
// no network — so every case here runs without mocking anything.

import { describe, expect, it } from "vitest";
import { BATCH_OWNER_COOKIE_MAX_AGE_SECONDS, BATCH_OWNER_COOKIE_NAME, buildOwnerCookieHeader, readOrIssueOwnerId } from "./cookie";

describe("readOrIssueOwnerId", () => {
  it("reuses the existing owner id when the Cookie header already carries one", () => {
    const { ownerId, isNew } = readOrIssueOwnerId(`${BATCH_OWNER_COOKIE_NAME}=existing-owner-123`);

    expect(ownerId).toBe("existing-owner-123");
    expect(isNew).toBe(false);
  });

  it("finds the owner id among several other cookies on the same header", () => {
    const { ownerId, isNew } = readOrIssueOwnerId(`unrelated=abc; ${BATCH_OWNER_COOKIE_NAME}=existing-owner-123; other=xyz`);

    expect(ownerId).toBe("existing-owner-123");
    expect(isNew).toBe(false);
  });

  it("issues a fresh random id when no Cookie header is present at all", () => {
    const { ownerId, isNew } = readOrIssueOwnerId(null);

    expect(ownerId.length).toBeGreaterThan(0);
    expect(isNew).toBe(true);
  });

  it("issues a fresh random id when the Cookie header exists but doesn't carry this app's cookie", () => {
    const { ownerId, isNew } = readOrIssueOwnerId("unrelated=abc");

    expect(ownerId.length).toBeGreaterThan(0);
    expect(isNew).toBe(true);
  });

  it("issues a different id on every call when none was present, since each is a fresh random UUID", () => {
    const first = readOrIssueOwnerId(null);
    const second = readOrIssueOwnerId(null);

    expect(first.ownerId).not.toBe(second.ownerId);
  });

  it("decodes a URI-encoded cookie value back to its original form", () => {
    const encodedValue = encodeURIComponent("has spaces and = signs");
    const { ownerId } = readOrIssueOwnerId(`${BATCH_OWNER_COOKIE_NAME}=${encodedValue}`);

    expect(ownerId).toBe("has spaces and = signs");
  });
});

describe("buildOwnerCookieHeader", () => {
  it("carries the owner id and every required security/scoping attribute", () => {
    const header = buildOwnerCookieHeader("owner-abc-123");

    expect(header).toContain(`${BATCH_OWNER_COOKIE_NAME}=owner-abc-123`);
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${BATCH_OWNER_COOKIE_MAX_AGE_SECONDS}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
  });

  it("URI-encodes the owner id so a value with special characters can't break the header", () => {
    const header = buildOwnerCookieHeader("has spaces");

    expect(header).toContain(`${BATCH_OWNER_COOKIE_NAME}=${encodeURIComponent("has spaces")}`);
  });
});
