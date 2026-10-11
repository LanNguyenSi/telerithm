import { describe, expect, it } from "vitest";
import { isSavedLogViewStub, type SavedLogView, type SavedLogViewStub } from "@/types";

const stub: SavedLogViewStub = {
  id: "v1",
  teamId: "t1",
  ownerUserId: "u2",
  isShared: false,
  isDefault: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("isSavedLogViewStub", () => {
  it("is true for a stub without definition", () => {
    expect(isSavedLogViewStub(stub)).toBe(true);
  });

  it("is false for a full view", () => {
    const full = { ...stub, name: "Errors", definition: {} } as unknown as SavedLogView;
    expect(isSavedLogViewStub(full)).toBe(false);
  });
});
