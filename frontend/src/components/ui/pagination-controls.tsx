"use client";

export function PaginationControls({
  page,
  pageSize,
  total,
  pageSizeOptions = [25, 50, 100],
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-[24px] border border-line bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1 || !onPageChange}
          onClick={() => onPageChange?.(page - 1)}
          className="rounded-xl border border-line px-4 py-2 text-sm text-ink transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ← Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages || !onPageChange}
          onClick={() => onPageChange?.(page + 1)}
          className="rounded-xl border border-line px-4 py-2 text-sm text-ink transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next →
        </button>
      </div>

      <p className="text-sm text-muted">
        Page {Math.min(page, totalPages)} of {totalPages}
      </p>

      <label className="flex items-center gap-2 text-sm text-muted">
        <span>Rows:</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
          className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate-400"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
