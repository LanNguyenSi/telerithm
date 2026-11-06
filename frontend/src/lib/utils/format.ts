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
    return "text-amber-700 dark:text-amber-400";
  }
  if (level === "info") {
    return "text-sky-700 dark:text-signal";
  }
  return "text-muted";
}
