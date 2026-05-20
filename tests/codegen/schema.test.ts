import { describe, expect, it } from "bun:test";
import { emitTypeDef, emitTypeRef } from "../../scripts/codegen/emit/schema.js";

describe("emitTypeRef", () => {
  it("string primitive", () => {
    expect(emitTypeRef({ type: "string" }, "Page")).toBe("Schema.String");
  });

  it("integer primitive", () => {
    expect(emitTypeRef({ type: "integer" }, "Page")).toBe("Schema.Number");
  });

  it("number primitive", () => {
    expect(emitTypeRef({ type: "number" }, "Page")).toBe("Schema.Number");
  });

  it("boolean primitive", () => {
    expect(emitTypeRef({ type: "boolean" }, "Page")).toBe("Schema.Boolean");
  });

  it("any → Schema.Json", () => {
    expect(emitTypeRef({ type: "any" }, "Page")).toBe("Schema.Json");
  });

  it("object without properties → Schema.Json", () => {
    expect(emitTypeRef({ type: "object" }, "Page")).toBe("Schema.Json");
  });

  it("object with properties → Schema.Struct", () => {
    const result = emitTypeRef(
      { type: "object", properties: [{ name: "url", type: "string" }] } as any,
      "Page",
    );
    expect(result).toContain("Schema.Struct");
    expect(result).toContain('"url"');
    expect(result).toContain("Schema.String");
  });

  it("array of strings", () => {
    expect(emitTypeRef({ type: "array", items: { type: "string" } }, "Page")).toBe(
      "Schema.Array(Schema.String)",
    );
  });

  it("array without items → Schema.Array(Schema.Json)", () => {
    expect(emitTypeRef({ type: "array" }, "Page")).toBe("Schema.Array(Schema.Json)");
  });

  it("$ref same domain", () => {
    expect(emitTypeRef({ $ref: "FrameId" }, "Page")).toBe("FrameId");
  });

  it("$ref cross domain", () => {
    expect(emitTypeRef({ $ref: "Runtime.RemoteObjectId" }, "Page")).toBe("Runtime.RemoteObjectId");
  });

  it("enum inline", () => {
    const result = emitTypeRef({ enum: ["foo", "bar"] } as any, "Page");
    expect(result).toContain("Schema.Literals");
    expect(result).toContain('"foo"');
    expect(result).toContain('"bar"');
  });

  it("unknown type falls back to Schema.Json", () => {
    expect(emitTypeRef({ type: "unknown-type" } as any, "Page")).toBe("Schema.Json");
  });
});

describe("emitTypeDef", () => {
  it("simple string typedef", () => {
    const result = emitTypeDef({ id: "FrameId", type: "string" }, "Page");
    expect(result).toContain("export const FrameId");
    expect(result).toContain("Schema.String");
    expect(result).toContain('"Page.FrameId"');
  });

  it("enum typedef", () => {
    const result = emitTypeDef({ id: "TransitionType", type: "string", enum: ["link", "typed", "auto_bookmark"] } as any, "Page");
    expect(result).toContain("export const TransitionType");
    expect(result).toContain("Schema.Literals");
    expect(result).toContain('"link"');
  });

  it("struct typedef", () => {
    const result = emitTypeDef(
      { id: "Rect", type: "object", properties: [{ name: "x", type: "number" }] } as any,
      "Page",
    );
    expect(result).toContain("export const Rect");
    expect(result).toContain("Schema.Struct");
    expect(result).toContain('"x"');
  });
});
