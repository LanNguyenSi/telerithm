import { Card } from "@/components/ui/card";

export function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-[0.2em] text-muted">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-1.5 text-xs text-muted">{hint}</p>
    </Card>
  );
}
