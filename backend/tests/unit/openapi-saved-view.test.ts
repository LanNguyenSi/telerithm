import { describe, expect, it } from "vitest";
import { openApiSpec } from "../../src/api/openapi.js";

describe("OpenAPI saved view update response", () => {
  const spec = openApiSpec as unknown as {
    paths: Record<
      string,
      Record<string, { responses: Record<string, { content: Record<string, { schema: { $ref: string } }> }> }>
    >;
    components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
  };

  it("PUT /logs/views/{id} 200 references the update response", () => {
    const schema = spec.paths["/logs/views/{id}"].put.responses["200"].content["application/json"].schema;
    expect(schema.$ref).toBe("#/components/schemas/SavedViewUpdateResponse");
  });

  it("update response view is anyOf full view or stub, never oneOf", () => {
    const view = spec.components.schemas.SavedViewUpdateResponse.properties?.view as {
      anyOf?: Array<{ $ref: string }>;
      oneOf?: unknown;
    };
    expect(view.oneOf).toBeUndefined();
    expect(view.anyOf?.map((s) => s.$ref)).toEqual([
      "#/components/schemas/SavedView",
      "#/components/schemas/SavedViewStub",
    ]);
  });

  it("stub schema omits name and definition", () => {
    const props = Object.keys(spec.components.schemas.SavedViewStub.properties ?? {});
    expect(props).not.toContain("name");
    expect(props).not.toContain("definition");
    expect(props).toEqual(
      expect.arrayContaining([
        "id",
        "teamId",
        "ownerUserId",
        "isShared",
        "isDefault",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("create still references the full view response", () => {
    const schema = spec.paths["/logs/views"].post.responses["201"].content["application/json"].schema;
    expect(schema.$ref).toBe("#/components/schemas/SavedViewResponse");
  });
});
