import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ThemeSwitch } from "@/components/settings/theme-switch";

// The jsdom environment here exposes no usable localStorage, so use an in-memory one.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  document.documentElement.classList.add("dark");
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

describe("ThemeSwitch: pressed state", () => {
  it("marks Dark pressed and Light not pressed when <html> has the dark class", () => {
    render(<ThemeSwitch />);
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
  });

  it("marks Light pressed when <html> has no dark class", () => {
    document.documentElement.classList.remove("dark");
    render(<ThemeSwitch />);
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
  });

  it("flips both buttons, the class and the stored theme on click", () => {
    render(<ThemeSwitch />);
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("colours the pressed button sky-700 in light and signal in dark, never bare text-signal", () => {
    render(<ThemeSwitch />);
    const pressed = screen.getByRole("button", { name: "Dark" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    expect(pressed.className).toContain("text-sky-700");
    expect(pressed.className).toContain("dark:text-signal");
    expect(pressed.className.split(/\s+/)).not.toContain("text-signal");

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    const light = screen.getByRole("button", { name: "Light" });
    expect(light).toHaveAttribute("aria-pressed", "true");
    expect(light.className).toContain("text-sky-700");
    expect(light.className.split(/\s+/)).not.toContain("text-signal");
  });

  it("groups the buttons as Appearance and hides the decorative icons", () => {
    const { container } = render(<ThemeSwitch />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeInTheDocument();
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
