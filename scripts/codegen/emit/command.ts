import type { CommandDef, Property } from "../types.js";
import { emitJSDoc } from "./jsdoc.js";
import { emitTypeRef } from "./schema.js";

const indent = (source: string, spaces: number): string => {
  const padding = " ".repeat(spaces);
  return source
    .split("\n")
    .map((line) => `${padding}${line}`)
    .join("\n");
};

const emitLiteral = (value: string): string => JSON.stringify(value);

const emitPropertySchema = (
  property: Property,
  domain: string,
  cyclicDomains?: ReadonlySet<string>,
): string => {
  const schema = emitTypeRef(property, domain, cyclicDomains);
  return property.optional === true ? `Schema.optional(${schema})` : schema;
};

const emitStruct = (
  domain: string,
  name: string,
  suffix: "params" | "result",
  properties: ReadonlyArray<Property> | undefined,
  cyclicDomains?: ReadonlySet<string>,
): string => {
  const fields =
    properties?.map((property) => {
      const jsdoc = emitJSDoc(property);
      const field = `${emitLiteral(property.name)}: ${emitPropertySchema(property, domain, cyclicDomains)}`;
      return jsdoc.length === 0 ? field : `${jsdoc}\n${field}`;
    }) ?? [];
  const body =
    fields.length === 0 ? "" : `\n${indent(fields.join(",\n"), 4)}\n  `;
  return `Schema.Struct({${body}}).annotate({ identifier: ${emitLiteral(`${domain}.${name}.${suffix}`)} })`;
};

const emitResult = (
  domain: string,
  cmd: CommandDef,
  cyclicDomains?: ReadonlySet<string>,
): string => {
  if (cmd.returns === undefined || cmd.returns.length === 0) {
    return `Schema.Struct({}).annotate({ identifier: ${emitLiteral(`${domain}.${cmd.name}.result`)} })`;
  }
  return emitStruct(domain, cmd.name, "result", cmd.returns, cyclicDomains);
};

export function emitCommand(
  domain: string,
  cmd: CommandDef,
  cyclicDomains?: ReadonlySet<string>,
): string {
  const jsdoc = emitJSDoc(cmd);
  const declaration = [
    `export const ${cmd.name} = {`,
    `  method: ${emitLiteral(`${domain}.${cmd.name}`)} as const,`,
    `  params: ${emitStruct(domain, cmd.name, "params", cmd.parameters, cyclicDomains)},`,
    `  result: ${emitResult(domain, cmd, cyclicDomains)},`,
    `} as const`,
  ].join("\n");

  return jsdoc.length === 0 ? declaration : `${jsdoc}\n${declaration}`;
}
