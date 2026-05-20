import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Protocol } from "../../../scripts/codegen/types.js";

export function loadFixture(name: string): Protocol {
  const raw = readFileSync(join(import.meta.dir, `${name}.json`), "utf-8");
  return JSON.parse(raw) as Protocol;
}
