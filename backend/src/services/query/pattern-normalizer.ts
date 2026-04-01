const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g;
const QUOTED_RE = /"[^"]*"|'[^']*'/g;
const HEX_RE = /\b0x[0-9a-f]+\b/gi;
const ID_RE = /\b[a-zA-Z_][a-zA-Z0-9_-]*\d+[a-zA-Z0-9_-]*\b/g;
const NUMBER_RE = /\b\d+\b/g;
const SPACE_RE = /\s+/g;

export function normalizePatternMessage(message: string): string {
  return message
    .replace(UUID_RE, "<UUID>")
    .replace(TIMESTAMP_RE, "<TS>")
    .replace(QUOTED_RE, "<QUOTED>")
    .replace(HEX_RE, "<HEX>")
    .replace(ID_RE, "<ID>")
    .replace(NUMBER_RE, "<N>")
    .replace(SPACE_RE, " ")
    .trim()
    .toLowerCase();
}

export function patternSignatureSqlExpression(column = "message"): string {
  return [
    `replaceRegexpAll(`,
    `replaceRegexpAll(`,
    `replaceRegexpAll(`,
    `replaceRegexpAll(`,
    `replaceRegexpAll(`,
    `replaceRegexpAll(`,
    `lowerUTF8(${column}),`,
    `'(?i)\\\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\\\b',`,
    `'<uuid>'),`,
    `'\\\\b\\\\d{4}-\\\\d{2}-\\\\d{2}[t ]\\\\d{2}:\\\\d{2}:\\\\d{2}(?:[.,]\\\\d+)?(?:z|[+-]\\\\d{2}:\\\\d{2})?\\\\b',`,
    `'<ts>'),`,
    `'"[^"]*"|''[^'']*''',`,
    `'<quoted>'),`,
    `'(?i)\\\\b0x[0-9a-f]+\\\\b',`,
    `'<hex>'),`,
    `'\\\\b[a-zA-Z_][a-zA-Z0-9_-]*\\\\d+[a-zA-Z0-9_-]*\\\\b',`,
    `'<id>'),`,
    `'\\\\b\\\\d+\\\\b',`,
    `'<n>')`,
  ].join("");
}
