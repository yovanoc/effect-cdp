import type { EventDef, Property } from "../types.js";
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

const emitParams = (
  domain: string,
  evt: EventDef,
  cyclicDomains?: ReadonlySet<string>,
): string => {
  const fields =
    evt.parameters?.map((property) => {
      const jsdoc = emitJSDoc(property);
      const field = `${emitLiteral(property.name)}: ${emitPropertySchema(property, domain, cyclicDomains)}`;
      return jsdoc.length === 0 ? field : `${jsdoc}\n${field}`;
    }) ?? [];
  const body =
    fields.length === 0 ? "" : `\n${indent(fields.join(",\n"), 4)}\n  `;
  return `Schema.Struct({${body}}).annotate({ identifier: ${emitLiteral(`${domain}.${evt.name}.params`)} })`;
};

export function emitEvent(
  domain: string,
  evt: EventDef,
  cyclicDomains?: ReadonlySet<string>,
): string {
  const jsdoc = emitJSDoc(evt);
  const declaration = [
    `export const ${evt.name} = {`,
    `  method: ${emitLiteral(`${domain}.${evt.name}`)} as const,`,
    `  params: ${emitParams(domain, evt, cyclicDomains)},`,
    `} as const`,
  ].join("\n");

  return jsdoc.length === 0 ? declaration : `${jsdoc}\n${declaration}`;
}
