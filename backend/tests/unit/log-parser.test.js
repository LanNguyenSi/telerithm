import { describe, expect, it } from "vitest";
import { LogParser } from "../../src/parser/log-parser.js";
describe("LogParser", () => {
    const parser = new LogParser();
    it("detects json format", () => {
        expect(parser.detectFormat('{"message":"hello"}')).toBe("json");
    });
    it("parses plain logs into normalized entries", () => {
        const [entry] = parser.parseRaw("payment error timeout", "plain", "team-1", "source-1");
        expect(entry.teamId).toBe("team-1");
        expect(entry.sourceId).toBe("source-1");
        expect(entry.level).toBe("error");
    });
});
