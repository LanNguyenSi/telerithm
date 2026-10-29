import { describe, expect, it } from "vitest";

import {
  buildSubscriptionPayload,
  type SubscriptionFormValues,
} from "@/app/(dashboard)/alerts/subscriptions/subscription-input";

const base: SubscriptionFormValues = {
  ruleId: "",
  channel: "WEBHOOK",
  url: "https://hooks.example.com/pager",
  secret: "",
  severities: [],
};

const ruleIds = ["r1", "r2"];

function build(overrides: Partial<SubscriptionFormValues> = {}) {
  return buildSubscriptionPayload("team-1", { ...base, ...overrides }, ruleIds);
}

describe("buildSubscriptionPayload", () => {
  it("builds a team-wide WEBHOOK payload with every severity (empty list) and no ruleId or secret", () => {
    expect(build()).toEqual({
      ok: true,
      payload: {
        teamId: "team-1",
        channel: "WEBHOOK",
        config: { url: "https://hooks.example.com/pager" },
        severities: [],
      },
    });
  });

  it("keys the URL as `url` for WEBHOOK and as `webhook_url` for SLACK and MSTEAMS", () => {
    expect(build({ channel: "SLACK" })).toMatchObject({
      ok: true,
      payload: { channel: "SLACK", config: { webhook_url: "https://hooks.example.com/pager" } },
    });
    expect(build({ channel: "MSTEAMS" })).toMatchObject({
      ok: true,
      payload: { channel: "MSTEAMS", config: { webhook_url: "https://hooks.example.com/pager" } },
    });
  });

  it("sends a trimmed URL and a trimmed secret, WEBHOOK only", () => {
    expect(build({ url: "  https://hooks.example.com/x  ", secret: " s3cret " })).toMatchObject({
      ok: true,
      payload: { config: { url: "https://hooks.example.com/x", secret: "s3cret" } },
    });
  });

  it("drops a secret typed before switching to SLACK or MSTEAMS", () => {
    for (const channel of ["SLACK", "MSTEAMS"]) {
      const result = build({ channel, secret: "left-over" });
      expect(result.ok && result.payload.config).toEqual({ webhook_url: "https://hooks.example.com/pager" });
    }
  });

  it("omits a blank secret instead of sending an empty one", () => {
    const result = build({ secret: "   " });
    expect(result.ok && "secret" in result.payload.config).toBe(false);
  });

  it("includes ruleId only when a rule is picked", () => {
    expect(build({ ruleId: "r2" })).toMatchObject({ ok: true, payload: { ruleId: "r2" } });
    const none = build({ ruleId: "" });
    expect(none.ok && "ruleId" in none.payload).toBe(false);
  });

  it("rejects a rule that is not one of the team's rules", () => {
    expect(build({ ruleId: "elsewhere" })).toMatchObject({ ok: false, field: "ruleId" });
  });

  it("sends severities in canonical order without duplicates or unknown levels", () => {
    const result = build({ severities: ["LOW", "CRITICAL", "LOW", "BOGUS", "HIGH"] });
    expect(result.ok && result.payload.severities).toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it.each(["", "EMAIL", "webhook", "SMS"])("rejects the channel %j", (channel) => {
    expect(build({ channel })).toMatchObject({ ok: false, field: "channel" });
  });

  it.each(["WEBHOOK", "SLACK", "MSTEAMS"])("requires a URL for %s", (channel) => {
    for (const url of ["", "   "]) {
      expect(build({ channel, url })).toMatchObject({ ok: false, field: "url", message: expect.stringMatching(/is required/) });
    }
  });

  it.each(["hooks.example.com/x", "not a url", "https://", "http://"])("rejects %j as not a full URL", (url) => {
    expect(build({ url })).toMatchObject({ ok: false, field: "url" });
  });

  it.each(["ftp://hooks.example.com/x", "javascript:alert(1)", "file:///etc/passwd"])("rejects the scheme of %j", (url) => {
    expect(build({ url })).toMatchObject({ ok: false, field: "url", message: expect.stringMatching(/https:\/\/ or http:\/\//) });
  });

  it("accepts http as well as https", () => {
    expect(build({ url: "http://hooks.example.com/x" }).ok).toBe(true);
  });

  it("names the channel's own field in the message", () => {
    expect(build({ channel: "SLACK", url: "" })).toMatchObject({ message: "Slack webhook URL is required." });
    expect(build({ channel: "MSTEAMS", url: "" })).toMatchObject({ message: "Teams webhook URL is required." });
  });

  it("checks the channel before the rule and the rule before the URL", () => {
    expect(build({ channel: "EMAIL", ruleId: "elsewhere", url: "" })).toMatchObject({ field: "channel" });
    expect(build({ ruleId: "elsewhere", url: "" })).toMatchObject({ field: "ruleId" });
  });
});
