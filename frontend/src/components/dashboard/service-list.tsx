import { Card } from "@/components/ui/card";

export function ServiceList({
  services,
}: {
  services: Array<{ service: string; count: number }>;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-ink">Top Services</h2>
          <p className="text-sm text-muted">Traffic concentration across the observed period.</p>
        </div>
      </div>
      <div className="mt-6 space-y-4">
        {services.map((item) => (
          <div key={item.service} className="grid grid-cols-[1fr_auto] items-center gap-4">
            <div>
              <p className="font-medium text-ink">{item.service}</p>
              <div className="mt-2 h-2 rounded-full bg-slate-900/5">
                <div
                  className="h-2 rounded-full bg-signal"
                  style={{ width: `${Math.min(item.count * 12, 100)}%` }}
                />
              </div>
            </div>
            <span className="font-mono text-sm text-muted">{item.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

