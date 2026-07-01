import { describe, expect, it } from "vitest";
import { computeFingerprint, normalizeMessage } from "../../src/services/ingestion/fingerprint.js";

describe("normalizeMessage", () => {
  it("replaces UUIDs with <UUID>", () => {
    const result = normalizeMessage(
      "user 123e4567-e89b-12d3-a456-426614174000 not found",
    );
    expect(result).toBe("user <UUID> not found");
  });

  it("replaces ISO timestamps with <TS>", () => {
    const result = normalizeMessage("request failed at 2024-01-15T10:30:00.123Z");
    expect(result).toBe("request failed at <TS>");
  });

  it("replaces IPv4 addresses with <IP>", () => {
    const result = normalizeMessage("connection from 192.168.1.10 refused");
    expect(result).toBe("connection from <IP> refused");
  });

  it("replaces hex literals with <HEX>", () => {
    const result = normalizeMessage("segfault at address 0x7ffeedc9a3f0");
    expect(result).toBe("segfault at address <HEX>");
  });

  it("replaces file:line references with <PATH>", () => {
    const result = normalizeMessage("error thrown at /app/src/index.js:42");
    expect(result).toBe("error thrown at <PATH>");
  });

  it("replaces bare numbers with <N>", () => {
    const result = normalizeMessage("retry attempt 3 of 5 failed");
    expect(result).toBe("retry attempt <N> of <N> failed");
  });

  it("trims leading and trailing whitespace", () => {
    const result = normalizeMessage("   padded message   ");
    expect(result).toBe("padded message");
  });

  it("does NOT normalize case (dedup is case-sensitive on remaining text)", () => {
    expect(normalizeMessage("Connection Refused")).toBe("Connection Refused");
    expect(normalizeMessage("connection refused")).toBe("connection refused");
  });

  it("applies replacements in combination for a realistic log line", () => {
    const result = normalizeMessage(
      "User 123e4567-e89b-12d3-a456-426614174000 from 10.0.0.5 hit /handlers/user.ts:88 at 2024-05-01T00:00:00Z after 7 retries",
    );
    expect(result).toBe("User <UUID> from <IP> hit <PATH> at <TS> after <N> retries");
  });
});

describe("computeFingerprint", () => {
  it("returns a 16-character lowercase hex string", () => {
    const fp = computeFingerprint("error", "api", "Something broke");
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces the same fingerprint for identical level/service/message (dedup correctness)", () => {
    const a = computeFingerprint("error", "checkout-api", "Payment gateway timeout");
    const b = computeFingerprint("error", "checkout-api", "Payment gateway timeout");
    expect(a).toBe(b);
  });

  it("produces the same fingerprint when only the normalized-away parts differ (dynamic tokens)", () => {
    const a = computeFingerprint(
      "error",
      "checkout-api",
      "Payment gateway timeout after 3 retries for user 123e4567-e89b-12d3-a456-426614174000",
    );
    const b = computeFingerprint(
      "error",
      "checkout-api",
      "Payment gateway timeout after 9 retries for user 999e4567-e89b-12d3-a456-426614174999",
    );
    expect(a).toBe(b);
  });

  it("produces a distinct fingerprint when the message differs beyond normalization", () => {
    const a = computeFingerprint("error", "checkout-api", "Payment gateway timeout");
    const b = computeFingerprint("error", "checkout-api", "Payment gateway rejected");
    expect(a).not.toBe(b);
  });

  it("produces a distinct fingerprint when level differs", () => {
    const a = computeFingerprint("error", "checkout-api", "Payment gateway timeout");
    const b = computeFingerprint("warn", "checkout-api", "Payment gateway timeout");
    expect(a).not.toBe(b);
  });

  it("produces a distinct fingerprint when service differs", () => {
    const a = computeFingerprint("error", "checkout-api", "Payment gateway timeout");
    const b = computeFingerprint("error", "billing-api", "Payment gateway timeout");
    expect(a).not.toBe(b);
  });

  it("is sensitive to case in the non-normalized remainder (not case-normalized)", () => {
    const a = computeFingerprint("error", "api", "Connection Refused");
    const b = computeFingerprint("error", "api", "connection refused");
    expect(a).not.toBe(b);
  });

  it("is a deterministic pure function across repeated calls", () => {
    const results = new Set(
      Array.from({ length: 5 }, () => computeFingerprint("fatal", "worker", "OOM killed")),
    );
    expect(results.size).toBe(1);
  });
});
