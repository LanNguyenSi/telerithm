import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  addAdminUserToTeam: vi.fn(),
  approveAdminUser: vi.fn(),
  removeAdminUserFromTeam: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  addAdminUserToTeam: mocks.addAdminUserToTeam,
  approveAdminUser: mocks.approveAdminUser,
  removeAdminUserFromTeam: mocks.removeAdminUserFromTeam,
}));
vi.mock("@/components/admin/add-to-team-modal", () => ({ AddToTeamModal: () => null }));

import { UserTable } from "@/components/admin/user-table";
import type { AdminUser, Team } from "@/types";

const team = { id: "t1", name: "Platform Operations", slug: "platform-ops", createdAt: "2026-01-01T00:00:00.000Z" };
const user: AdminUser = {
  id: "u1",
  email: "ada@example.test",
  name: "Ada Lovelace",
  role: "USER",
  status: "ACTIVE",
  createdAt: "2026-01-05T00:00:00.000Z",
  teams: [{ id: "t1", name: "Platform Operations", slug: "platform-ops", role: "MEMBER", joinedAt: "2026-01-06T00:00:00.000Z" }],
};

function renderTable() {
  return render(<UserTable initialUsers={[user]} teams={[{ ...team, memberCount: 1 }] as Array<Team & { memberCount: number }>} token="tok" />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UserTable — Remove is a 24x24 target (WCAG 2.5.8)", () => {
  it("gives the Remove button min-h-6 and min-w-6 sizing classes", () => {
    renderTable();
    const button = screen.getByRole("button", { name: "Remove" });
    expect(button.className).toContain("min-h-6");
    expect(button.className).toContain("min-w-6");
  });
});

describe("UserTable — removing a team member asks for confirmation first", () => {
  it("opens a confirm dialog naming the user and the team instead of removing directly", async () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Remove Ada Lovelace from Platform Operations\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Ada Lovelace will lose member access to the Platform Operations team/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(mocks.removeAdminUserFromTeam).not.toHaveBeenCalled();
  });

  it("does not call the API on cancel and keeps the member listed", async () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.removeAdminUserFromTeam).not.toHaveBeenCalled();
    expect(screen.getByText("Platform Operations")).toBeInTheDocument();
  });

  it("calls the API once on confirm", async () => {
    mocks.removeAdminUserFromTeam.mockResolvedValue(undefined);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mocks.removeAdminUserFromTeam).toHaveBeenCalledTimes(1));
    expect(mocks.removeAdminUserFromTeam).toHaveBeenCalledWith("u1", "t1", "tok");
  });
});
