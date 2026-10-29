import { getAlertRules, getSubscriptions } from "@/lib/api/client";
import { requireAuth } from "@/lib/auth/guard";
import { SubscriptionsView } from "./subscriptions-view";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const { token, team } = await requireAuth();
  const [{ subscriptions }, { rules }] = await Promise.all([
    getSubscriptions(team.id, token),
    getAlertRules(team.id, token),
  ]);

  return <SubscriptionsView subscriptions={subscriptions} rules={rules} teamId={team.id} token={token} />;
}
