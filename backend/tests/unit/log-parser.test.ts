import { describe, expect, it } from "vitest";
import { LogParser } from "../../src/parser/log-parser.js";

describe("LogParser", () => {
  const parser = new LogParser();

  describe("detectFormat", () => {
    it("detects JSON format", () => {
      expect(parser.detectFormat('{"message":"hello"}')).toBe("json");
    });

    it("detects JSON array format", () => {
      expect(parser.detectFormat('[{"message":"hello"}]')).toBe("json");
    });

    it("detects RFC3164 syslog", () => {
      expect(parser.detectFormat("<34>Oct 11 22:14:15 mymachine su: pam_unix")).toBe("syslog_rfc3164");
    });

    it("detects RFC5424 syslog", () => {
      expect(parser.detectFormat("<165>1 2003-10-11T22:14:15.003Z mymachine evntslog - ID47 - msg")).toBe(
        "syslog_rfc5424",
      );
    });

    it("falls back to plain", () => {
      expect(parser.detectFormat("just a plain log line")).toBe("plain");
    });
  });

  describe("parseRaw", () => {
    it("parses plain logs with error level detection", () => {
      const [entry] = parser.parseRaw("payment error timeout", "plain", "team-1", "source-1");
      expect(entry.teamId).toBe("team-1");
      expect(entry.sourceId).toBe("source-1");
      expect(entry.level).toBe("error");
      expect(entry.message).toBe("payment error timeout");
    });

    it("parses plain logs with warn level detection", () => {
      const [entry] = parser.parseRaw("warning: disk space low", "plain", "t1", "s1");
      expect(entry.level).toBe("warn");
    });

    it("parses plain logs defaulting to info", () => {
      const [entry] = parser.parseRaw("user logged in successfully", "plain", "t1", "s1");
      expect(entry.level).toBe("info");
    });

    it("parses JSON log entry", () => {
      const json = JSON.stringify({
        message: "test",
        level: "error",
        service: "api",
        host: "web-1",
      });
      const [entry] = parser.parseRaw(json, "json", "t1", "s1");
      expect(entry.level).toBe("error");
      expect(entry.service).toBe("api");
      expect(entry.host).toBe("web-1");
      expect(entry.message).toBe("test");
    });

    it("parses JSON array of logs", () => {
      const json = JSON.stringify([
        { message: "first", level: "info" },
        { message: "second", level: "warn" },
      ]);
      const entries = parser.parseRaw(json, "json", "t1", "s1");
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe("first");
      expect(entries[1].level).toBe("warn");
    });

    it("generates unique IDs for each entry", () => {
      const entries = parser.parseRaw(
        JSON.stringify([{ message: "a" }, { message: "b" }]),
        "json",
        "t1",
        "s1",
      );
      expect(entries[0].id).not.toBe(entries[1].id);
    });
  });
});

describe("LogParser — parseRaw syslog formats", () => {
  const parser = new LogParser();

  it("parses RFC3164 syslog entry", () => {
    const raw = "<34>Oct 11 22:14:15 mymachine su: pam_unix: session opened for user root";
    const [entry] = parser.parseRaw(raw, "syslog_rfc3164", "t1", "s1");
    expect(entry.host).toBe("mymachine");
    expect(entry.service).toBe("su");
    expect(entry.message).toBe("pam_unix: session opened for user root");
    expect(entry.teamId).toBe("t1");
    expect(entry.sourceId).toBe("s1");
  });

  it("parses RFC5424 syslog entry", () => {
    const raw =
      "<165>1 2003-10-11T22:14:15.003Z mymachine evntslog - ID47 - BOMAn application event log entry";
    const [entry] = parser.parseRaw(raw, "syslog_rfc5424", "t1", "s1");
    expect(entry.host).toBe("mymachine");
    expect(entry.service).toBe("evntslog");
    expect(entry.teamId).toBe("t1");
  });

  it("falls back to parsePlain for malformed RFC3164", () => {
    const raw = "not a valid rfc3164 message";
    const [entry] = parser.parseRaw(raw, "syslog_rfc3164", "t1", "s1");
    expect(entry.message).toBe(raw);
    expect(entry.service).toBe("unknown");
  });

  it("falls back to parsePlain for malformed RFC5424", () => {
    const raw = "not a valid rfc5424 message";
    const [entry] = parser.parseRaw(raw, "syslog_rfc5424", "t1", "s1");
    expect(entry.message).toBe(raw);
    expect(entry.service).toBe("unknown");
  });
});

describe("LogParser — JSON edge cases", () => {
  const parser = new LogParser();

  it("uses message as fallback for non-string JSON content", () => {
    const json = JSON.stringify({ level: "error", data: { nested: true } });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    // message should be stringified JSON when no message field
    expect(typeof entry.message).toBe("string");
  });

  it("handles JSON with timestamp field", () => {
    const ts = "2026-04-02T12:00:00.000Z";
    const json = JSON.stringify({ message: "test", level: "info", timestamp: ts });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    expect(entry.timestamp).toBe(ts);
  });

  it("handles JSON with fields object", () => {
    const json = JSON.stringify({
      message: "test",
      level: "info",
      fields: { requestId: "abc123", duration: 42 },
    });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    expect(entry.fields).toEqual({ requestId: "abc123", duration: 42 });
  });

  it("uses unknown service/host for JSON without those fields", () => {
    const json = JSON.stringify({ message: "test", level: "info" });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    expect(entry.service).toBe("unknown");
    expect(entry.host).toBe("unknown");
  });
});

describe("LogParser — normalizeLevel edge cases", () => {
  const parser = new LogParser();

  it("detects error level from 'fatal error' in plain log (normalizeLevel detects 'err' in text)", () => {
    const [entry] = parser.parseRaw("fatal error: system crash", "plain", "t1", "s1");
    // plain mode uses normalizeLevel on raw text; 'error' appears → level=error
    expect(entry.level).toBe("error");
  });

  it("detects info level from debug message without error/warn keywords", () => {
    const [entry] = parser.parseRaw("processing request id abc123", "plain", "t1", "s1");
    // no level keywords → defaults to info
    expect(entry.level).toBe("info");
  });

  it("detects fatal level in JSON log", () => {
    const json = JSON.stringify({ message: "crash", level: "fatal" });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    expect(entry.level).toBe("fatal");
  });

  it("detects debug level in JSON log", () => {
    const json = JSON.stringify({ message: "debug info", level: "debug" });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    expect(entry.level).toBe("debug");
  });

  it("normalizes 'err' level variants to error in JSON", () => {
    const json = JSON.stringify({ message: "test", level: "ERR" });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    expect(entry.level).toBe("error");
  });

  it("normalizes 'WARNING' level to warn in JSON", () => {
    const json = JSON.stringify({ message: "test", level: "WARNING" });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    expect(entry.level).toBe("warn");
  });

  it("defaults unknown level to info in JSON", () => {
    const json = JSON.stringify({ message: "test", level: "unknown-level" });
    const [entry] = parser.parseRaw(json, "json", "t1", "s1");
    expect(entry.level).toBe("info");
  });
});
