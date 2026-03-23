import { Card } from "@/components/ui/card";

export function ServiceList({ services }: { services: Array<{ service: string; count: number }> }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Top Services</h2>
          <p className="text-xs text-muted">Traffic concentration across the observed period.</p>
        </div>
      </div>
      {services.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-white/50 p-8 text-center dark:bg-white/5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted"
          >
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          <p className="text-sm font-medium text-ink">No services detected</p>
          <p className="max-w-xs text-sm text-muted">Start ingesting logs to see service traffic here.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {services.map((item) => (
            <div key={item.service} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div>
                <p className="font-mono text-sm text-ink">{item.service}</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-900/5 dark:bg-white/5">
                  <div
                    className="h-1.5 rounded-full bg-signal"
                    style={{ width: `${Math.min(item.count * 12, 100)}%` }}
                  />
                </div>
              </div>
              <span className="font-mono text-xs text-muted">{item.count}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
