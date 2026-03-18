export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function levelTone(level: string): string {
  if (level === "error" || level === "fatal") {
    return "text-danger";
  }
  if (level === "warn") {
    return "text-amber-600";
  }
  if (level === "info") {
    return "text-signal";
  }
  return "text-muted";
}

