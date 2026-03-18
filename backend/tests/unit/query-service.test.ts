import { describe, expect, it } from "vitest";
import { QueryService } from "../../src/services/query/query-service.js";
import { store } from "../../src/repositories/in-memory-store.js";

describe("QueryService", () => {
  const service = new QueryService();

  it("filters logs by natural language heuristics", () => {
    const teamId = store.teams[0].id;
    const result = service.search({
      teamId,
      query: "show payment errors",
      queryType: "natural",
      limit: 20,
      offset: 0,
    });
    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.logs.every((log) => log.service === "payment")).toBe(true);
  });
});
