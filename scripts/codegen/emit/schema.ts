import type { Property, TypeDef, TypeRef } from "../types.js";

const primitiveSchemas = {
  string: "Schema.String",
  integer: "Schema.Int",
  number: "Schema.Finite",
  boolean: "Schema.Boolean",
  any: "Schema.Json",
} satisfies Readonly<Record<string, string>>;

const indent = (source: string, spaces: number): string => {
  const padding = " ".repeat(spaces);
  return source
    .split("\n")
    .map((line) => `${padding}${line}`)
    .join("\n");
};

const emitLiteral = (value: string): string => JSON.stringify(value);

const emitIdentifier = (value: string): string => JSON.stringify(value);

const emitRef = (
  ref: string,
  currentDomain: string,
  cyclicDomains?: ReadonlySet<string>,
): string => {
  const separator = ref.indexOf(".");
  if (separator === -1) {
    return ref;
  }
  const refDomain = ref.slice(0, separator);
  const refName = ref.slice(separator + 1);
  if (refDomain === currentDomain) {
    return refName;
  }
  const qualified = `${refDomain}.${refName}`;
  // Cross-domain ref where both sides are in the same import cycle: wrap in
  // Schema.suspend so the reference is resolved lazily after both modules
  // have finished initializing. Without this, JS hoisting yields a
  // ReferenceError at module-load time.
  if (
    cyclicDomains !== undefined &&
    cyclicDomains.has(currentDomain) &&
    cyclicDomains.has(refDomain)
  ) {
    return `Schema.suspend(() => ${qualified})`;
  }
  return qualified;
};

const emitEnum = (values: ReadonlyArray<string>): string =>
  `Schema.Literals([${values.map(emitLiteral).join(", ")}])`;

const emitObject = (
  properties: ReadonlyArray<Property> | undefined,
  domain: string,
  cyclicDomains?: ReadonlySet<string>,
): string => {
  if (properties === undefined || properties.length === 0) {
    return "Schema.Json";
  }

  const fields = properties.map((property) => {
    const schema = emitPropertySchema(property, domain, cyclicDomains);
    return `${emitIdentifier(property.name)}: ${schema}`;
  });

  return `Schema.Struct({\n${indent(fields.join(",\n"), 2)}\n})`;
};

const emitPropertySchema = (
  property: Property,
  domain: string,
  cyclicDomains?: ReadonlySet<string>,
): string => {
  const schema = emitTypeRef(property, domain, cyclicDomains);
  return property.optional === true ? `Schema.optional(${schema})` : schema;
};

export function emitTypeRef(
  ref: TypeRef,
  domain: string,
  cyclicDomains?: ReadonlySet<string>,
): string {
  if (ref.$ref !== undefined) {
    return emitRef(ref.$ref, domain, cyclicDomains);
  }

  if ("enum" in ref && Array.isArray(ref.enum)) {
    return emitEnum(ref.enum);
  }

  if (ref.type === "array") {
    return ref.items === undefined
      ? "Schema.Array(Schema.Json)"
      : `Schema.Array(${emitTypeRef(ref.items, domain, cyclicDomains)})`;
  }

  if (ref.type === "object") {
    const properties =
      "properties" in ref && Array.isArray(ref.properties)
        ? ref.properties
        : undefined;
    return emitObject(properties, domain, cyclicDomains);
  }

  if (ref.type !== undefined && ref.type in primitiveSchemas) {
    return primitiveSchemas[ref.type];
  }

  return "Schema.Json";
}

export function emitTypeDef(
  td: TypeDef,
  domain: string,
  cyclicDomains?: ReadonlySet<string>,
): string {
  const schema =
    td.enum !== undefined
      ? emitEnum(td.enum)
      : emitTypeRef(td, domain, cyclicDomains);
  return `export const ${td.id} = ${schema}.annotate({ identifier: ${emitIdentifier(`${domain}.${td.id}`)} });`;
}
