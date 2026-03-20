export interface Breadcrumb {
  timestamp: string;
  category: string;
  message: string;
  level?: string;
  data?: Record<string, unknown>;
}

export class BreadcrumbTracker {
  private crumbs: Breadcrumb[] = [];
  private readonly maxCrumbs: number;
  private cleanups: Array<() => void> = [];

  constructor(maxCrumbs = 20) {
    this.maxCrumbs = maxCrumbs;
  }

  add(crumb: Omit<Breadcrumb, "timestamp">): void {
    this.crumbs.push({
      ...crumb,
      timestamp: new Date().toISOString(),
    });
    if (this.crumbs.length > this.maxCrumbs) {
      this.crumbs.shift();
    }
  }

  getAll(): Breadcrumb[] {
    return [...this.crumbs];
  }

  clear(): void {
    this.crumbs = [];
  }

  /** Automatically capture console.warn/error as breadcrumbs */
  instrumentConsole(): void {
    if (typeof console === "undefined") return;

    const origWarn = console.warn;
    const origError = console.error;

    console.warn = (...args: unknown[]) => {
      this.add({ category: "console", message: args.map(String).join(" "), level: "warn" });
      origWarn.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
      this.add({ category: "console", message: args.map(String).join(" "), level: "error" });
      origError.apply(console, args);
    };

    this.cleanups.push(() => {
      console.warn = origWarn;
      console.error = origError;
    });
  }

  teardown(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }
}
