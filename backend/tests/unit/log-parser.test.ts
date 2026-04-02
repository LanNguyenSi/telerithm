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
