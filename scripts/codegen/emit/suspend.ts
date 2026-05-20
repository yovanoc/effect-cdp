import type { Property, TypeDef, TypeRef } from "../types.js";

const identifierPart = (value: string): string => {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
};

const stringLiteral = (value: string): string =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const typeRefName = (ref: string, currentDomain: string): string => {
  const separator = ref.indexOf(".");
  if (separator === -1) {
    return ref;
  }
  const refDomain = ref.slice(0, separator);
  const refName = ref.slice(separator + 1);
  return refDomain === currentDomain ? refName : `${refDomain}.${refName}`;
};

const literalUnion = (values: ReadonlyArray<string>): string =>
  values.map((value) => JSON.stringify(value)).join(" | ");

const emitTsType = (
  ref: TypeRef | Property | TypeDef,
  domain: string,
): string => {
  if ("$ref" in ref && ref.$ref !== undefined) {
    return `Schema.Schema.Type<typeof ${typeRefName(ref.$ref, domain)}>`;
  }

  if ("enum" in ref && Array.isArray(ref.enum)) {
    return literalUnion(ref.enum);
  }

  if (ref.type === "array") {
    const item =
      ref.items === undefined
        ? "Schema.Schema.Type<typeof Schema.Json>"
        : emitTsType(ref.items, domain);
    return `ReadonlyArray<${item}>`;
  }

  if (ref.type === "object") {
    return "properties" in ref && Array.isArray(ref.properties)
      ? emitInterfaceBody(ref.properties, domain)
      : "Schema.Schema.Type<typeof Schema.Json>";
  }

  switch (ref.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "any":
    case undefined:
      return "Schema.Schema.Type<typeof Schema.Json>";
  }
  return "Schema.Schema.Type<typeof Schema.Json>";
};

const propertyKey = (name: string): string => JSON.stringify(name);

function emitInterfaceBody(
  properties: ReadonlyArray<Property>,
  domain: string,
): string {
  if (properties.length === 0) {
    return "Schema.Schema.Type<typeof Schema.Json>";
  }
  const lines = properties.map((property) => {
    const optional = property.optional === true;
    const value = optional
      ? `${emitTsType(property, domain)} | undefined`
      : emitTsType(property, domain);
    return `  readonly ${propertyKey(property.name)}${optional ? "?" : ""}: ${value}`;
  });
  return `{
${lines.join("\n")}
}`;
}

export function wrapWithSuspend(
  typeId: string,
  domain: string,
  innerSchema: string,
  typeDef: TypeDef,
): string {
  const schemaName = identifierPart(typeId);
  const typeName = `${identifierPart(domain)}${identifierPart(typeId)}Type`;
  const identifier = stringLiteral(`${domain}.${typeId}`);
  const typeBody =
    typeDef.properties === undefined
      ? "Schema.Schema.Type<typeof Schema.Json>"
      : emitInterfaceBody(typeDef.properties, domain);

  return [
    `export interface ${typeName} ${typeBody}`,
    `export const ${schemaName}: Schema.Schema<${typeName}> = Schema.suspend(`,
    `  () => ${innerSchema}`,
    `).annotate({ identifier: ${identifier} })`,
  ].join("\n");
}
