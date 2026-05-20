import { describe, expect, it } from "vitest";
import { emitJSDoc } from "../../scripts/codegen/emit/jsdoc.js";

describe("emitJSDoc", () => {
  it("plain item → empty string", () => {
    expect(emitJSDoc({ description: "some description" })).toBe("");
  });

  it("no fields → empty string", () => {
    expect(emitJSDoc({})).toBe("");
  });

  it("deprecated → contains @deprecated", () => {
    const result = emitJSDoc({ deprecated: true, description: "old api" });
    expect(result).toContain("@deprecated");
    expect(result).toContain("old api");
  });

  it("experimental → contains @experimental", () => {
    const result = emitJSDoc({ experimental: true, description: "new api" });
    expect(result).toContain("@experimental");
    expect(result).toContain("new api");
  });

  it("both deprecated and experimental → single block with both", () => {
    const result = emitJSDoc({
      deprecated: true,
      experimental: true,
      description: "gone soon",
    });
    expect(result).toContain("@deprecated");
    expect(result).toContain("@experimental");
    expect(result).toContain("gone soon");
    // Should be a single JSDoc block
    expect(result.split("/**").length).toBe(2);
  });

  it("no @example in any output", () => {
    const result = emitJSDoc({
      deprecated: true,
      experimental: true,
      description: "test",
    });
    expect(result).not.toContain("@example");
  });
});
