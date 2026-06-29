import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the child logger instance so we can assert on it.
// vi.hoisted ensures this runs before vi.mock() factory functions execute.
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
  createChildLogger: () => mockLog,
}));

import { sendEmail } from "../../src/services/notification/channels/email.js";

describe("sendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs the email with the correct 'to' address", async () => {
    await sendEmail({ to: "user@example.com", subject: "Alert fired", body: "details" });
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com" }),
      expect.any(String),
    );
  });

  it("logs the email with the correct 'subject'", async () => {
    await sendEmail({ to: "ops@example.com", subject: "CRITICAL Alert", body: "details" });
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "CRITICAL Alert" }),
      expect.any(String),
    );
  });

  it("logs both 'to' and 'subject' in the same log.info call", async () => {
    await sendEmail({ to: "team@example.com", subject: "High Alert", body: "payload" });
    expect(mockLog.info).toHaveBeenCalledWith(
      { to: "team@example.com", subject: "High Alert" },
      "Email notification (SMTP not configured, logging only)",
    );
  });

  it("does NOT include the body in the structured log object", async () => {
    await sendEmail({ to: "a@b.com", subject: "S", body: "sensitive-body-content" });
    const [logObj] = mockLog.info.mock.calls[0] as [Record<string, unknown>];
    expect(logObj).not.toHaveProperty("body");
  });

  it("calls log.info exactly once per send", async () => {
    await sendEmail({ to: "a@b.com", subject: "S", body: "B" });
    expect(mockLog.info).toHaveBeenCalledOnce();
  });

  it("resolves without throwing", async () => {
    await expect(
      sendEmail({ to: "a@b.com", subject: "S", body: "B" }),
    ).resolves.toBeUndefined();
  });

  it("does not call log.warn or log.error", async () => {
    await sendEmail({ to: "a@b.com", subject: "S", body: "B" });
    expect(mockLog.warn).not.toHaveBeenCalled();
    expect(mockLog.error).not.toHaveBeenCalled();
  });
});
