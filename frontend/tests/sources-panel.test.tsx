import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createSource: vi.fn(),
  renameSource: vi.fn(),
  deleteSource: vi.fn(),
  rotateSourceKey: vi.fn(),
  revealSourceKey: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/api/client", () => ({
  createSource: mocks.createSource,
  renameSource: mocks.renameSource,
  deleteSource: mocks.deleteSource,
  rotateSourceKey: mocks.rotateSourceKey,
  revealSourceKey: mocks.revealSourceKey,
}));

import { SourcesPanel } from "@/components/settings/sources-panel";
import type { Source, TeamRole } from "@/types";

const source: Source = {
  id: "src-1",
  teamId: "team-1",
  name: "web",
  type: "HTTP",
  retentionDays: 7,
  keyHint: "lf_****_key",
};

/** What the list API sends for the fixture source, and the full key behind it. */
const MASKED = "lf_****_key";
const FULL_KEY = "lf_existing_key";

function renderPanel(role: TeamRole, sources: Source[] = [source]) {
  return render(<SourcesPanel sources={sources} teamId="team-1" token="tok" role={role} />);
}

function renderWithHint(keyHint: string): RenderResult {
  return renderPanel("OWNER", [{ ...source, keyHint }]);
}

/** A promise the test settles by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.revealSourceKey.mockResolvedValue({ apiKey: FULL_KEY });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SourcesPanel", () => {
  it("hides the create control from a VIEWER but still lists sources", () => {
    renderPanel("VIEWER");
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New source" })).toBeNull();
  });

  it.each(["VIEWER", "MEMBER"] as const)(
    "renders sources that carry no keyHint for %s without a key pill or the word undefined",
    (role) => {
      const { keyHint: _omitted, ...keyless } = source;
      const { container } = renderPanel(role, [keyless, { ...keyless, id: "src-2", name: "api", type: "DOCKER" }]);
      expect(screen.getByText("web")).toBeInTheDocument();
      expect(screen.getByText("api")).toBeInTheDocument();
      expect(screen.getByText("HTTP")).toBeInTheDocument();
      expect(screen.getByText("DOCKER")).toBeInTheDocument();
      expect(container.querySelector("span.font-mono")).toBeNull();
      expect(screen.queryByRole("button", { name: /API key of/ })).toBeNull();
      expect(container.textContent).not.toMatch(/undefined/);
      expect(mocks.revealSourceKey).not.toHaveBeenCalled();
    },
  );

  it.each(["OWNER", "ADMIN"] as const)(
    "shows the key hint of a listed source to %s without asking the API for the key",
    (role) => {
      const { container } = renderPanel(role);
      expect(screen.getByText(MASKED)).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/lf_existing_key/);
      expect(mocks.revealSourceKey).not.toHaveBeenCalled();
    },
  );

  it.each(["OWNER", "ADMIN", "MEMBER"] as const)("shows the create control for %s", (role) => {
    renderPanel(role);
    expect(screen.getByRole("button", { name: "New source" })).toBeInTheDocument();
  });

  it("empty state points at the dialog instead of only at curl or the script", () => {
    renderPanel("MEMBER", []);
    expect(screen.getByText(/Create a source with New source/)).toBeInTheDocument();
    expect(screen.queryByText(/not created in the UI yet/i)).toBeNull();
    expect(screen.queryByText(/setup-sources\.sh/)).toBeNull();
  });

  it("creates a source, shows the returned key once and refreshes on Done", async () => {
    mocks.createSource.mockResolvedValue({ source: { ...source, id: "src-2", name: "api", apiKey: "lf_newkey" } });
    renderPanel("MEMBER", []);

    fireEvent.click(screen.getByRole("button", { name: "New source" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "DOCKER" } });
    fireEvent.click(screen.getByRole("button", { name: "Create source" }));

    await waitFor(() => expect(mocks.createSource).toHaveBeenCalledWith("tok", {
      teamId: "team-1",
      name: "api",
      type: "DOCKER",
    }));
    expect(await screen.findByTestId("new-source-api-key")).toHaveTextContent("lf_newkey");
    expect(mocks.refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("new-source-api-key")).toBeNull();
  });

  it("copies the key to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mocks.createSource.mockResolvedValue({ source: { ...source, apiKey: "lf_newkey" } });
    renderPanel("OWNER", []);

    fireEvent.click(screen.getByRole("button", { name: "New source" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "Create source" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy key" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("lf_newkey"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("reports a failed copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    mocks.createSource.mockResolvedValue({ source: { ...source, apiKey: "lf_newkey" } });
    renderPanel("OWNER", []);

    fireEvent.click(screen.getByRole("button", { name: "New source" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "Create source" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy key" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Copy failed/);
  });

  it("shows the API error and keeps the form when creation fails", async () => {
    mocks.createSource.mockRejectedValue(new Error("Forbidden"));
    renderPanel("MEMBER", []);

    fireEvent.click(screen.getByRole("button", { name: "New source" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "Create source" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(screen.queryByTestId("new-source-api-key")).toBeNull();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("rejects a too-short name without calling the API", async () => {
    renderPanel("MEMBER", []);
    fireEvent.click(screen.getByRole("button", { name: "New source" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Create source" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 2 characters/);
    expect(mocks.createSource).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog without a refresh", () => {
    renderPanel("MEMBER");
    fireEvent.click(screen.getByRole("button", { name: "New source" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("SourcesPanel: key hint and reveal in the list", () => {
  it("shows the hint exactly as the API sent it, whatever its shape", () => {
    const { container } = renderPanel("OWNER", [{ ...source, keyHint: "****" }]);
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(/^\*\*\*\*$/);
    expect(container.textContent).not.toMatch(/lf_existing_key/);
  });

  it("reveals the full key on click through the API and hides it again", async () => {
    const { container } = renderPanel("OWNER");
    const reveal = screen.getByRole("button", { name: "Reveal API key of web" });
    expect(reveal).toHaveAttribute("aria-pressed", "false");
    expect(mocks.revealSourceKey).not.toHaveBeenCalled();

    fireEvent.click(reveal);

    expect(await screen.findByRole("button", { name: "Hide API key of web" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(mocks.revealSourceKey).toHaveBeenCalledExactlyOnceWith("src-1", "tok");
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(FULL_KEY);

    fireEvent.click(screen.getByRole("button", { name: "Hide API key of web" }));

    expect(screen.getByTestId("source-api-key")).toHaveTextContent(MASKED);
    expect(screen.getByRole("button", { name: "Reveal API key of web" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(container.textContent).not.toMatch(/lf_existing_key/);
    expect(mocks.revealSourceKey).toHaveBeenCalledTimes(1);

    // The hidden key was dropped, so the next reveal asks the API again.
    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    expect(await screen.findByRole("button", { name: "Hide API key of web" })).toBeInTheDocument();
    expect(mocks.revealSourceKey).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state while the reveal is in flight and keeps the hint until it answers", async () => {
    const pending = deferred<{ apiKey: string }>();
    mocks.revealSourceKey.mockReturnValueOnce(pending.promise);
    const { container } = renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));

    const busy = screen.getByRole("button", { name: "Reveal API key of web" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveTextContent("Loading...");
    expect(screen.getByRole("button", { name: "Copy API key of web" })).toBeDisabled();
    expect(screen.getByTestId("source-key-status")).toHaveTextContent("Loading the key");
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(MASKED);
    expect(container.textContent).not.toMatch(/lf_existing_key/);

    await act(async () => {
      pending.resolve({ apiKey: FULL_KEY });
    });

    expect(screen.getByTestId("source-api-key")).toHaveTextContent(FULL_KEY);
    expect(screen.getByRole("button", { name: "Hide API key of web" })).toBeEnabled();
    expect(screen.getByTestId("source-key-status")).toBeEmptyDOMElement();
  });

  it.each([
    ["403", new Error("Forbidden")],
    ["404", new Error("Source not found")],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("shows an error and keeps the hint when the reveal fails with %s", async (_case, failure) => {
    mocks.revealSourceKey.mockRejectedValueOnce(failure);
    const { container } = renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Could not reveal the key/);
    expect(alert).toHaveTextContent((failure as Error).message);
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(MASKED);
    expect(container.textContent).not.toMatch(/lf_existing_key/);
    expect(screen.getByRole("button", { name: "Reveal API key of web" })).toBeEnabled();

    // A retry clears the stale error and succeeds.
    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    expect(await screen.findByRole("button", { name: "Hide API key of web" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("copies the full key to the clipboard without revealing it or keeping it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Copy API key of web" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL_KEY));
    expect(mocks.revealSourceKey).toHaveBeenCalledExactlyOnceWith("src-1", "tok");
    expect(container.textContent).not.toMatch(/lf_existing_key/);
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(MASKED);
    expect(await screen.findByRole("button", { name: "Copied API key of web" })).toBeInTheDocument();

    // Nothing was kept: another copy asks the API again.
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied API key of web" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copied API key of web" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(mocks.revealSourceKey).toHaveBeenCalledTimes(2);
  });

  it("copies the held key without another API call while the row is revealed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    await screen.findByRole("button", { name: "Hide API key of web" });
    fireEvent.click(screen.getByRole("button", { name: "Copy API key of web" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL_KEY));
    expect(mocks.revealSourceKey).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(FULL_KEY);
  });

  it("does not touch the clipboard and shows an error when the key cannot be fetched for a copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mocks.revealSourceKey.mockRejectedValueOnce(new Error("Forbidden"));
    renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Copy API key of web" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Could not copy the key/);
    expect(alert).toHaveTextContent("Forbidden");
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copy API key of web" })).toBeInTheDocument();
  });

  it("reports a failed copy of a listed key", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Copy API key of web" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Copy failed/);
  });

  it("drops the revealed key when the hint changes", async () => {
    const view = renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    await screen.findByRole("button", { name: "Hide API key of web" });

    view.rerender(
      <SourcesPanel
        sources={[{ ...source, keyHint: "lf_****_new" }]}
        teamId="team-1"
        token="tok"
        role="OWNER"
      />,
    );

    expect(screen.getByTestId("source-api-key")).toHaveTextContent("lf_****_new");
    expect(screen.getByRole("button", { name: "Reveal API key of web" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(view.container.textContent).not.toMatch(/lf_existing_key/);
  });

  it("drops the revealed key when the source's key is rotated, even before the list refreshes", async () => {
    mocks.rotateSourceKey.mockResolvedValue({ source: { ...source, apiKey: "lf_rotated" } });
    const { container } = renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    await screen.findByRole("button", { name: "Hide API key of web" });
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(FULL_KEY);

    fireEvent.click(screen.getByRole("button", { name: "Rotate key of web" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rotate key" }));
    await screen.findByTestId("rotated-source-api-key");

    expect(screen.getByTestId("source-api-key")).toHaveTextContent(MASKED);
    expect(screen.getByRole("button", { name: "Reveal API key of web" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(container.textContent).not.toMatch(/lf_existing_key/);
  });

  it("ignores a reveal reply that arrives after the source's key was rotated", async () => {
    const pending = deferred<{ apiKey: string }>();
    mocks.revealSourceKey.mockReturnValueOnce(pending.promise);
    mocks.rotateSourceKey.mockResolvedValue({ source: { ...source, apiKey: "lf_rotated" } });
    const { container } = renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate key of web" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rotate key" }));
    await screen.findByTestId("rotated-source-api-key");

    await act(async () => {
      pending.resolve({ apiKey: FULL_KEY });
    });

    expect(container.textContent).not.toMatch(/lf_existing_key/);
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(MASKED);
  });

  it("clears the revealed key from the DOM on unmount and ignores a reply that arrives later", async () => {
    const pending = deferred<{ apiKey: string }>();
    mocks.revealSourceKey.mockReturnValueOnce(pending.promise);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    view.unmount();
    await act(async () => {
      pending.resolve({ apiKey: FULL_KEY });
    });

    expect(document.body.textContent).not.toMatch(/lf_existing_key/);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();

    const second = renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    await screen.findByRole("button", { name: "Hide API key of web" });
    second.unmount();
    expect(document.body.textContent).not.toMatch(/lf_existing_key/);
  });
});

describe("SourcesPanel: the copy feedback of a listed key is transient and single sided", () => {
  const copyButton = () => screen.getByRole("button", { name: /Copy API key of web/ });
  const status = () => screen.getByTestId("source-key-status");

  function stubClipboard(...results: ("ok" | "denied")[]) {
    const writeText = vi.fn();
    for (const result of results) {
      if (result === "ok") writeText.mockResolvedValueOnce(undefined);
      else writeText.mockRejectedValueOnce(new Error("denied"));
    }
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  }

  /** Flushes the clipboard promise and the state it sets, for use with fake timers. */
  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("reverts Copied on a timer and copies again on the next click", async () => {
    vi.useFakeTimers();
    const writeText = stubClipboard("ok", "ok");
    renderPanel("OWNER");

    fireEvent.click(copyButton());
    await settle();
    expect(screen.getByRole("button", { name: "Copied API key of web" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByRole("button", { name: "Copy API key of web" })).toBeInTheDocument();
    expect(status()).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Copy API key of web" }));
    await settle();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenNthCalledWith(2, FULL_KEY);
    expect(screen.getByRole("button", { name: "Copied API key of web" })).toBeInTheDocument();
  });

  it("clears the failure note when a later copy succeeds", async () => {
    const writeText = stubClipboard("denied", "ok");
    renderPanel("OWNER");

    fireEvent.click(copyButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Copy failed/);

    fireEvent.click(screen.getByRole("button", { name: "Copy API key of web" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: "Copied API key of web" })).toBeInTheDocument();
  });

  it("clears Copied when a later copy fails", async () => {
    const writeText = stubClipboard("ok", "denied");
    renderPanel("OWNER");
    const button = screen.getByRole("button", { name: "Copy API key of web" });

    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Copied API key of web" })).toBeInTheDocument();

    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Copy failed/);
    expect(screen.queryByRole("button", { name: "Copied API key of web" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy API key of web" })).toBeInTheDocument();
  });

  it("clears its pending Copied timer when the row unmounts", async () => {
    vi.useFakeTimers();
    stubClipboard("ok");
    const view = renderPanel("OWNER");
    const timersAfterRender = vi.getTimerCount();

    fireEvent.click(copyButton());
    await settle();
    expect(screen.getByRole("button", { name: "Copied API key of web" })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBeGreaterThan(timersAfterRender);

    view.unmount();
    expect(vi.getTimerCount()).toBe(timersAfterRender);
  });

  it("resets a revealed row, its Copied label and its failure note when the hint changes", async () => {
    const writeText = stubClipboard("ok", "denied");
    const view = renderWithHint(MASKED);

    fireEvent.click(screen.getByRole("button", { name: "Reveal API key of web" }));
    await screen.findByRole("button", { name: "Hide API key of web" });
    fireEvent.click(copyButton());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Copied API key of web" })).toBeInTheDocument(),
    );
    expect(screen.getByTestId("source-api-key")).toHaveTextContent(FULL_KEY);

    view.rerender(
      <SourcesPanel
        sources={[{ ...source, keyHint: "lf_****_new" }]}
        teamId="team-1"
        token="tok"
        role="OWNER"
      />,
    );

    expect(screen.getByTestId("source-api-key")).toHaveTextContent("lf_****_new");
    expect(screen.getByRole("button", { name: "Reveal API key of web" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Copy API key of web" })).toBeInTheDocument();
    expect(screen.getByTestId("source-key-status")).toBeEmptyDOMElement();

    fireEvent.click(copyButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Copy failed/);

    view.rerender(
      <SourcesPanel
        sources={[{ ...source, keyHint: "lf_****gain" }]}
        teamId="team-1"
        token="tok"
        role="OWNER"
      />,
    );

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("source-key-status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("source-api-key")).toHaveTextContent("lf_****gain");
  });

  it("announces the copy outcome in a visually hidden polite live region", async () => {
    const writeText = stubClipboard("denied", "ok");
    renderPanel("OWNER");

    const region = status();
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("sr-only");
    expect(region).toBeEmptyDOMElement();

    fireEvent.click(copyButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Copy failed/);
    expect(region).toHaveTextContent(/Copy failed/);

    fireEvent.click(screen.getByRole("button", { name: "Copy API key of web" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(region).toHaveTextContent("Copied"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SourcesPanel: rename, rotate key and delete", () => {
  it.each(["OWNER", "ADMIN"] as const)("shows rename, rotate key and delete for %s", (role) => {
    renderPanel(role);
    expect(screen.getByRole("button", { name: "Rename web" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rotate key of web" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete web" })).toBeInTheDocument();
  });

  it.each(["MEMBER", "VIEWER"] as const)("hides rename, rotate key and delete from %s but still lists the source", (role) => {
    renderPanel(role);
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Rotate key/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("renames only after the prompt is confirmed, with the trimmed new name", async () => {
    mocks.renameSource.mockResolvedValue({ source: { ...source, name: "web-2" } });
    renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Rename web" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toHaveValue("web");
    expect(mocks.renameSource).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  web-2 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(mocks.renameSource).toHaveBeenCalledWith("src-1", "tok", { name: "web-2" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rejects a too-short new name without calling the API", async () => {
    renderPanel("ADMIN");
    fireEvent.click(screen.getByRole("button", { name: "Rename web" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "a" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 2 characters/);
    expect(mocks.renameSource).not.toHaveBeenCalled();
  });

  it("does not rename when the prompt is cancelled", () => {
    renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Rename web" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mocks.renameSource).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes only after the confirm step, and says stored logs stay", async () => {
    mocks.deleteSource.mockResolvedValue(undefined);
    renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Delete web" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Delete source "web"\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Logs already stored are not deleted/)).toBeInTheDocument();
    expect(mocks.deleteSource).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.deleteSource).toHaveBeenCalledWith("src-1", "tok"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it("does not delete when the confirm step is cancelled", () => {
    renderPanel("ADMIN");
    fireEvent.click(screen.getByRole("button", { name: "Delete web" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mocks.deleteSource).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the API error and does not refresh when the delete fails", async () => {
    mocks.deleteSource.mockRejectedValue(new Error("Source not found"));
    renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Delete web" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Source not found");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("rotates only after the confirm step, shows the new key once and refreshes on Done", async () => {
    mocks.rotateSourceKey.mockResolvedValue({ source: { ...source, apiKey: "lf_rotated" } });
    renderPanel("OWNER");

    fireEvent.click(screen.getByRole("button", { name: "Rotate key of web" }));
    const confirm = screen.getByRole("dialog");
    expect(within(confirm).getByText(/stops working at once/)).toBeInTheDocument();
    expect(within(confirm).getByText(/Owners and admins can reveal it again later/)).toBeInTheDocument();
    expect(within(confirm).queryByText(/shown only once/)).toBeNull();
    expect(mocks.rotateSourceKey).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Rotate key" }));

    expect(await screen.findByTestId("rotated-source-api-key")).toHaveTextContent("lf_rotated");
    expect(mocks.rotateSourceKey).toHaveBeenCalledWith("src-1", "tok");
    expect(screen.getByText(/shows only a\s+masked hint of the key/)).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("rotated-source-api-key")).toBeNull();
    expect(screen.queryByText("lf_rotated")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("copies the rotated key to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mocks.rotateSourceKey.mockResolvedValue({ source: { ...source, apiKey: "lf_rotated" } });
    renderPanel("ADMIN");

    fireEvent.click(screen.getByRole("button", { name: "Rotate key of web" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rotate key" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy key" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("lf_rotated"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("does not rotate when the confirm step is cancelled", () => {
    renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Rotate key of web" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(mocks.rotateSourceKey).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the API error and no key dialog when the rotation fails", async () => {
    mocks.rotateSourceKey.mockRejectedValue(new Error("Forbidden"));
    renderPanel("OWNER");
    fireEvent.click(screen.getByRole("button", { name: "Rotate key of web" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rotate key" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(screen.queryByTestId("rotated-source-api-key")).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
