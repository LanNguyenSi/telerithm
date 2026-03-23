/** Decode HTML entities that were stored by the legacy sanitizeHtml ingestion. */
export function decodeHtml(input: string): string {
  return input
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

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
