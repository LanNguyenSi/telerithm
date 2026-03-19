import { describe, expect, it } from "vitest";
import { hashPassword, hashPasswordSync, verifyPassword } from "../../src/utils/password.js";

describe("Password Utils", () => {
  it("hashes and verifies password (async)", async () => {
    const hash = await hashPassword("test-password");
    expect(hash).not.toBe("test-password");
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword("test-password", hash)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("hashes password synchronously", () => {
    const hash = hashPasswordSync("sync-test");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("generates different hashes for same input (salt)", async () => {
    const hash1 = await hashPassword("same");
    const hash2 = await hashPassword("same");
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword("same", hash1)).toBe(true);
    expect(await verifyPassword("same", hash2)).toBe(true);
  });
});
