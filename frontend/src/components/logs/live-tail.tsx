"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { decodeHtml, formatDate } from "@/lib/utils/format";
import { BROWSER_SESSION, createStreamTicket, streamLogs } from "@/lib/api/client";
import type { LogEntry } from "@/types";

// Pause between reconnect attempts: doubles after each failure up to the cap,
// and starts over once a connection has opened.
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// A filter field reconnects the stream on every change; waiting this long first
// keeps typing from fetching a ticket per keystroke.
const CONNECT_DEBOUNCE_MS = 250;

export function LiveTail({ teamId }: { teamId: string }) {
  const [items, setItems] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(true);
  const [level, setLevel] = useState("");
  const [service, setService] = useState("");
  const [host, setHost] = useState("");
  const [query, setQuery] = useState("");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!running) {
      sourceRef.current?.close();
      sourceRef.current = null;
      setConnected(false);
      return;
    }

    const filters = {
      level: level || undefined,
      service: service.trim() || undefined,
      host: host.trim() || undefined,
      query: query.trim() || undefined,
    };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = RECONNECT_MIN_MS;

    // EventSource cannot send the session cookie's token, and the token must
    // not be in the URL, so every connection first fetches a one-time ticket
    // through the same-origin proxy. A ticket is spent by its first use, so the
    // browser's own automatic reconnect (same URL) would be refused: on any
    // error the source is closed and a new ticket is fetched.
    function scheduleReconnect() {
      if (cancelled) return;
      setConnected(false);
      timer = setTimeout(() => void connect(), delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    }

    async function connect() {
      let ticket: string;
      try {
        ({ ticket } = await createStreamTicket(teamId, BROWSER_SESSION));
      } catch {
        scheduleReconnect();
        return;
      }
      if (cancelled) return;

      const source = streamLogs(teamId, ticket, filters);
      sourceRef.current = source;
      source.addEventListener("open", () => {
        setConnected(true);
        delay = RECONNECT_MIN_MS;
      });
      source.addEventListener("error", () => {
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
        scheduleReconnect();
      });
      source.addEventListener("log:new", (event) => {
        const log = JSON.parse(event.data) as LogEntry;
        setItems((current) => [log, ...current].slice(0, 8));
      });
    }

    timer = setTimeout(() => void connect(), CONNECT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [host, level, query, running, service, teamId]);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Live Tail</h2>
          <p className="text-xs text-muted">Dedicated stream mode, independent from historical search results.</p>
        </div>
        <span className={connected ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-muted"}>
          {running ? (connected ? "Connected" : "Waiting") : "Paused"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <input
          value={level}
          onChange={(event) => setLevel(event.target.value)}
          placeholder="level"
          className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs text-ink dark:bg-white/10"
        />
        <input
          value={service}
          onChange={(event) => setService(event.target.value)}
          placeholder="service"
          className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs text-ink dark:bg-white/10"
        />
        <input
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="host"
          className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs text-ink dark:bg-white/10"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="contains text"
          className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs text-ink dark:bg-white/10"
        />
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setRunning((value) => !value)}
          className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:text-ink"
        >
          {running ? "Pause stream" : "Resume stream"}
        </button>
        <button
          type="button"
          onClick={() => setItems([])}
          className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:text-ink"
        >
          Clear
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
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
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <p className="text-sm font-medium text-ink">No live events yet</p>
            <p className="max-w-xs text-sm text-muted">
              Send logs to the ingest endpoint to see them appear here in real time.
            </p>
          </div>
        ) : (
          items.map((log) => (
            <article key={log.id} className="rounded-xl border border-line bg-white/70 p-3 dark:bg-white/5">
              <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
                <span>{formatDate(log.timestamp)}</span>
                <span>{decodeHtml(log.service)}</span>
                <span>{log.level}</span>
              </div>
              <p className="mt-1.5 break-words [overflow-wrap:anywhere] text-sm text-ink">{decodeHtml(log.message)}</p>
            </article>
          ))
        )}
      </div>
    </Card>
  );
}
