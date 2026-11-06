import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/logs/l1",
  useRouter: () => router,
}));

import { LogsTabNav } from "@/components/logs/logs-tab-nav";

function stubHistoryLength(value: number) {
  Object.defineProperty(window.history, "length", { value, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window.history, "length");
});

describe("LogsTabNav — Back fallback on a direct load", () => {
  it("pushes /logs when there is no history entry to go back to", () => {
    stubHistoryLength(1);
    render(<LogsTabNav />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(router.push).toHaveBeenCalledWith("/logs");
    expect(router.back).not.toHaveBeenCalled();
  });

  it("calls router.back when there is a history entry", () => {
    stubHistoryLength(2);
    render(<LogsTabNav />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("gives the Back button the min-h-6 sizing class", () => {
    stubHistoryLength(2);
    render(<LogsTabNav />);
    expect(screen.getByRole("button", { name: "Back" }).className).toContain("min-h-6");
  });
});
