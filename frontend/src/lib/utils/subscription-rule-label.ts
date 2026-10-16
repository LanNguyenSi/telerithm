import type { AlertSubscription } from "@/types";

// A legacy subscription whose rule belongs to another team comes back with
// `rule: null` but a non-null `ruleId`; it never fires, so it must not be
// labelled team-wide. Only `ruleId: null` means "all rules in team".
export function subscriptionRuleLabel(sub: Pick<AlertSubscription, "rule" | "ruleId">): string {
  if (sub.rule) return `Rule: ${sub.rule.name}`;
  if (sub.ruleId !== null) return "Rule unavailable";
  return "All rules in team";
}
