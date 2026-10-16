import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteAlertRule, updateAlertRule } from "@/lib/api/client";

function failWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request() error messages", () => {
  it("keeps a plain string error as the message", async () => {
    failWith(404, { error: "Alert rule not found" });
    await expect(deleteAlertRule("r1", "tok")).rejects.toThrow("Alert rule not found");
  });

  it("turns a flattened validation error into a readable message", async () => {
    failWith(400, {
      error: {
        formErrors: ["At least one field is required"],
        fieldErrors: { name: ["Too small: expected at least 2"], windowMinutes: ["Too big", "Not an integer"] },
      },
    });
    const error = await updateAlertRule("r1", "tok", { name: "x" }).catch((e: Error) => e);
    expect((error as Error).message).toBe(
      "At least one field is required; name: Too small: expected at least 2; windowMinutes: Too big, Not an integer",
    );
    expect((error as Error).message).not.toContain("[object Object]");
  });

  it("falls back to the status line when the error object has no messages", async () => {
    failWith(400, { error: { formErrors: [], fieldErrors: {} } });
    await expect(deleteAlertRule("r1", "tok")).rejects.toThrow("API request failed: 400");
  });
});
