import { describe, expect, it } from "bun:test";
import { detectRecursive } from "../../scripts/codegen/detectRecursive.js";

describe("detectRecursive", () => {
  it("non-recursive types → empty set", () => {
    const types = [
      { id: "Leaf", type: "string" as const },
      { id: "Node", type: "object" as const, properties: [{ name: "value", type: "string" as const }] },
    ];
    const result = detectRecursive(types);
    expect(result.size).toBe(0);
  });

  it("self-referential type → detected", () => {
    const types = [
      {
        id: "Tree",
        type: "object" as const,
        properties: [
          { name: "children", type: "array" as const, items: { $ref: "Tree" } },
        ],
      },
    ];
    const result = detectRecursive(types);
    expect(result.has("Tree")).toBe(true);
  });

  it("mutually recursive types → both detected", () => {
    const types = [
      {
        id: "A",
        type: "object" as const,
        properties: [{ name: "b", $ref: "B" }],
      },
      {
        id: "B",
        type: "object" as const,
        properties: [{ name: "a", $ref: "A" }],
      },
    ];
    const result = detectRecursive(types);
    expect(result.has("A")).toBe(true);
    expect(result.has("B")).toBe(true);
  });

  it("non-recursive type NOT in result", () => {
    const types = [
      { id: "Leaf", type: "string" as const },
      {
        id: "Tree",
        type: "object" as const,
        properties: [{ name: "children", type: "array" as const, items: { $ref: "Tree" } }],
      },
    ];
    const result = detectRecursive(types);
    expect(result.has("Leaf")).toBe(false);
    expect(result.has("Tree")).toBe(true);
  });
});
