import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createSource: vi.fn(),
  renameSource: vi.fn(),
  deleteSource: vi.fn(),
  rotateSourceKey: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/api/client", () => ({
  createSource: mocks.createSource,
  renameSource: mocks.renameSource,
  deleteSource: mocks.deleteSource,
  rotateSourceKey: mocks.rotateSourceKey,
}));

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
    expect(mocks.rotateSourceKey).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Rotate key" }));

    expect(await screen.findByTestId("rotated-source-api-key")).toHaveTextContent("lf_rotated");
    expect(mocks.rotateSourceKey).toHaveBeenCalledWith("src-1", "tok");
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
