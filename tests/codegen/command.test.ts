import { describe, expect, it } from "bun:test";
import { emitCommand } from "../../scripts/codegen/emit/command.js";
import { emitEvent } from "../../scripts/codegen/emit/event.js";

describe("emitCommand", () => {
  it("command with params and result", () => {
    const result = emitCommand("Page", {
      name: "navigate",
      parameters: [{ name: "url", type: "string" }],
      returns: [{ name: "frameId", $ref: "FrameId" }],
    });
    expect(result).toContain('method: "Page.navigate" as const');
    expect(result).toContain("params: Schema.Struct");
    expect(result).toContain("result: Schema.Struct");
    expect(result).toContain('"url"');
    expect(result).toContain("FrameId");
    expect(result).toContain("Page.navigate.params");
    expect(result).toContain("Page.navigate.result");
    expect(result).not.toContain("Schema.TaggedRequest");
    expect(result).not.toContain("Rpc.");
  });

  it("empty params → Schema.Struct({})", () => {
    const result = emitCommand("Page", {
      name: "enable",
      parameters: [],
      returns: [],
    });
    expect(result).toContain("params: Schema.Struct({})");
    expect(result).toContain("result: Schema.Struct({}).annotate({ identifier: \"Page.enable.result\" })");
  });

  it("undefined params → Schema.Struct({})", () => {
    const result = emitCommand("Page", { name: "enable" });
    expect(result).toContain("params: Schema.Struct({})");
    expect(result).toContain("result: Schema.Struct({}).annotate({ identifier: \"Page.enable.result\" })");
  });

  it("method is as const literal", () => {
    const result = emitCommand("DOM", { name: "getDocument" });
    expect(result).toContain('"DOM.getDocument" as const');
  });

  it("deprecated command has JSDoc", () => {
    const result = emitCommand("Page", {
      name: "old",
      deprecated: true,
      description: "use new instead",
    });
    expect(result).toContain("@deprecated");
  });

  it("optional param wrapped in Schema.optional", () => {
    const result = emitCommand("Page", {
      name: "navigate",
      parameters: [{ name: "referrer", type: "string", optional: true }],
    });
    expect(result).toContain("Schema.optional(Schema.String)");
  });
});

describe("emitEvent", () => {
  it("event with params, no result", () => {
    const result = emitEvent("Page", {
      name: "loadEventFired",
      parameters: [{ name: "timestamp", type: "number" }],
    });
    expect(result).toContain('method: "Page.loadEventFired" as const');
    expect(result).toContain("params: Schema.Struct");
    expect(result).toContain('"timestamp"');
    expect(result).not.toContain("result:");
  });

  it("event has no result field", () => {
    const result = emitEvent("Network", {
      name: "requestWillBeSent",
      parameters: [{ name: "requestId", type: "string" }],
    });
    expect(result).not.toContain("result:");
  });

  it("method is as const literal", () => {
    const result = emitEvent("Page", { name: "frameNavigated" });
    expect(result).toContain('"Page.frameNavigated" as const');
  });

  it("empty params → Schema.Struct({})", () => {
    const result = emitEvent("Page", { name: "loadEventFired", parameters: [] });
    expect(result).toContain("params: Schema.Struct({})");
  });
});
