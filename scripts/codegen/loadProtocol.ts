import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sortProtocol } from "./sort.js";
import type {
  CDPType,
  CommandDef,
  Domain,
  EventDef,
  Property,
  Protocol,
  TypeDef,
  TypeRef,
} from "./types.js";

const protocolDirectory = join(
  process.cwd(),
  "node_modules",
  "devtools-protocol",
  "json",
);

const cdpTypes = new Set<CDPType>([
  "string",
  "integer",
  "number",
  "boolean",
  "array",
  "object",
  "any",
]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const optionalBoolean = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined => {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
};

const optionalNumber = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined => {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
};

const optionalStringArray = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): Array<string> | undefined => {
  const value = record[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
};

const optionalType = (
  record: Readonly<Record<string, unknown>>,
): CDPType | undefined => {
  const value = record["type"];
  return typeof value === "string" && cdpTypes.has(value as CDPType)
    ? (value as CDPType)
    : undefined;
};

const optionalTypeRef = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): TypeRef | undefined => {
  const value = record[key];
  return isRecord(value) ? readTypeRef(value) : undefined;
};

const readTypeRef = (record: Readonly<Record<string, unknown>>): TypeRef => {
  const type = optionalType(record);
  const ref = optionalString(record, "$ref");
  const items = optionalTypeRef(record, "items");
  return {
    ...(type === undefined ? {} : { type }),
    ...(ref === undefined ? {} : { $ref: ref }),
    ...(items === undefined ? {} : { items }),
  };
};

const readProperties = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): Array<Property> | undefined => {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter(isRecord).map(readProperty)
    : undefined;
};

const readProperty = (record: Readonly<Record<string, unknown>>): Property => {
  const name = optionalString(record, "name") ?? "";
  const type = optionalType(record);
  const ref = optionalString(record, "$ref");
  const description = optionalString(record, "description");
  const optional = optionalBoolean(record, "optional");
  const experimental = optionalBoolean(record, "experimental");
  const deprecated = optionalBoolean(record, "deprecated");
  const enumValues = optionalStringArray(record, "enum");
  const items = optionalTypeRef(record, "items");
  const minItems = optionalNumber(record, "minItems");
  const maxItems = optionalNumber(record, "maxItems");

  return {
    name,
    ...(type === undefined ? {} : { type }),
    ...(ref === undefined ? {} : { $ref: ref }),
    ...(description === undefined ? {} : { description }),
    ...(optional === undefined ? {} : { optional }),
    ...(experimental === undefined ? {} : { experimental }),
    ...(deprecated === undefined ? {} : { deprecated }),
    ...(enumValues === undefined ? {} : { enum: enumValues }),
    ...(items === undefined ? {} : { items }),
    ...(minItems === undefined ? {} : { minItems }),
    ...(maxItems === undefined ? {} : { maxItems }),
  };
};

const readTypeDef = (record: Readonly<Record<string, unknown>>): TypeDef => {
  const id = optionalString(record, "id") ?? "";
  const type = optionalType(record) ?? "object";
  const description = optionalString(record, "description");
  const experimental = optionalBoolean(record, "experimental");
  const deprecated = optionalBoolean(record, "deprecated");
  const enumValues = optionalStringArray(record, "enum");
  const properties = readProperties(record, "properties");
  const items = optionalTypeRef(record, "items");
  const minItems = optionalNumber(record, "minItems");
  const maxItems = optionalNumber(record, "maxItems");

  return {
    id,
    type,
    ...(description === undefined ? {} : { description }),
    ...(experimental === undefined ? {} : { experimental }),
    ...(deprecated === undefined ? {} : { deprecated }),
    ...(enumValues === undefined ? {} : { enum: enumValues }),
    ...(properties === undefined ? {} : { properties }),
    ...(items === undefined ? {} : { items }),
    ...(minItems === undefined ? {} : { minItems }),
    ...(maxItems === undefined ? {} : { maxItems }),
  };
};

const readCommand = (record: Readonly<Record<string, unknown>>): CommandDef => {
  const name = optionalString(record, "name") ?? "";
  const description = optionalString(record, "description");
  const experimental = optionalBoolean(record, "experimental");
  const deprecated = optionalBoolean(record, "deprecated");
  const parameters = readProperties(record, "parameters");
  const returns = readProperties(record, "returns");

  return {
    name,
    ...(description === undefined ? {} : { description }),
    ...(experimental === undefined ? {} : { experimental }),
    ...(deprecated === undefined ? {} : { deprecated }),
    ...(parameters === undefined ? {} : { parameters }),
    ...(returns === undefined ? {} : { returns }),
  };
};

const readEvent = (record: Readonly<Record<string, unknown>>): EventDef => {
  const name = optionalString(record, "name") ?? "";
  const description = optionalString(record, "description");
  const experimental = optionalBoolean(record, "experimental");
  const deprecated = optionalBoolean(record, "deprecated");
  const parameters = readProperties(record, "parameters");

  return {
    name,
    ...(description === undefined ? {} : { description }),
    ...(experimental === undefined ? {} : { experimental }),
    ...(deprecated === undefined ? {} : { deprecated }),
    ...(parameters === undefined ? {} : { parameters }),
  };
};

const readArray = <A>(
  record: Readonly<Record<string, unknown>>,
  key: string,
  readItem: (item: Readonly<Record<string, unknown>>) => A,
): Array<A> => {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord).map(readItem) : [];
};

const readDomain = (record: Readonly<Record<string, unknown>>): Domain => {
  const domain = optionalString(record, "domain") ?? "";
  const description = optionalString(record, "description");
  const experimental = optionalBoolean(record, "experimental");
  const deprecated = optionalBoolean(record, "deprecated");
  const dependencies = optionalStringArray(record, "dependencies");

  return {
    domain,
    ...(description === undefined ? {} : { description }),
    ...(experimental === undefined ? {} : { experimental }),
    ...(deprecated === undefined ? {} : { deprecated }),
    ...(dependencies === undefined ? {} : { dependencies }),
    types: readArray(record, "types", readTypeDef),
    commands: readArray(record, "commands", readCommand),
    events: readArray(record, "events", readEvent),
  };
};

const readProtocolFile = (fileName: string): Protocol => {
  const raw = readFileSync(join(protocolDirectory, fileName), "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { domains: [] };
  }
  return isRecord(parsed)
    ? { domains: readArray(parsed, "domains", readDomain) }
    : { domains: [] };
};

const mergeDomains = (
  browserDomains: Array<Domain>,
  jsDomains: Array<Domain>,
): Array<Domain> => {
  const merged = [...jsDomains];
  for (const browserDomain of browserDomains) {
    const index = merged.findIndex(
      (domain) => domain.domain === browserDomain.domain,
    );
    if (index === -1) {
      merged.push(browserDomain);
    } else {
      merged[index] = browserDomain;
    }
  }
  return merged;
};

export function loadProtocol(): Protocol {
  const browserProtocol = readProtocolFile("browser_protocol.json");
  const jsProtocol = readProtocolFile("js_protocol.json");
  return sortProtocol({
    domains: mergeDomains(browserProtocol.domains, jsProtocol.domains),
  });
}
