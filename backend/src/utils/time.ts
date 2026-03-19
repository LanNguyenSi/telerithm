export function nowIso(): string {
  return new Date().toISOString();
}

export function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}
