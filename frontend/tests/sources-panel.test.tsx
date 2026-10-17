import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createSource: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/api/client", () => ({ createSource: mocks.createSource }));

import { SourcesPanel } from "@/components/settings/sources-panel";
import type { Source, TeamRole } from "@/types";

const source: Source = {
  id: "src-1",
  teamId: "team-1",
  name: "web",
  type: "HTTP",
  retentionDays: 7,
  apiKey: "lf_existing",
};

function renderPanel(role: TeamRole, sources: Source[] = [source]) {
  return render(<SourcesPanel sources={sources} teamId="team-1" token="tok" role={role} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SourcesPanel", () => {
  it("hides the create control from a VIEWER but still lists sources", () => {
    renderPanel("VIEWER");
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New source" })).toBeNull();
  });

  it.each(["VIEWER", "MEMBER"] as const)(
    "renders sources that carry no apiKey for %s without a key pill or the word undefined",
    (role) => {
      const { apiKey: _omitted, ...keyless } = source;
      const { container } = renderPanel(role, [keyless, { ...keyless, id: "src-2", name: "api", type: "DOCKER" }]);
      expect(screen.getByText("web")).toBeInTheDocument();
      expect(screen.getByText("api")).toBeInTheDocument();
      expect(screen.getByText("HTTP")).toBeInTheDocument();
      expect(screen.getByText("DOCKER")).toBeInTheDocument();
      expect(container.querySelector("span.font-mono")).toBeNull();
      expect(container.textContent).not.toMatch(/undefined/);
    },
  );

  it.each(["OWNER", "ADMIN"] as const)("shows the existing key of a listed source to %s", (role) => {
    renderPanel(role);
    expect(screen.getByText("lf_existing")).toBeInTheDocument();
  });

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
