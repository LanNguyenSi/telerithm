import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserTable } from "@/components/admin/user-table";
import { AuthedShell } from "@/components/dashboard/authed-shell";
import { Card } from "@/components/ui/card";
import { getAdminTeams, getAdminUsers } from "@/lib/api/client";
import { requireAdmin } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const { token } = await requireAdmin();

  try {
    const [{ users }, { teams }] = await Promise.all([getAdminUsers(token), getAdminTeams(token)]);

    return (
      <AuthedShell>
        <div className="space-y-4 lg:space-y-6">
          <Card>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-muted">Admin</p>
                <h2 className="mt-2 text-2xl font-semibold text-ink">User management</h2>
              </div>
              <p className="text-sm text-muted">
                {users.length} users across {teams.length} teams
              </p>
            </div>
          </Card>

          <UserTable initialUsers={users} teams={teams} token={token} />
        </div>
      </AuthedShell>
    );
  } catch {
    redirect("/");
  }
}
