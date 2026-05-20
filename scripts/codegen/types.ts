export interface Protocol {
  domains: Array<Domain>;
}

export interface Domain {
  domain: string;
  description?: string;
  experimental?: boolean;
  deprecated?: boolean;
  dependencies?: Array<string>;
  types: Array<TypeDef>;
  commands: Array<CommandDef>;
  events: Array<EventDef>;
}

export interface TypeDef {
  id: string;
  type: CDPType;
  description?: string;
  experimental?: boolean;
  deprecated?: boolean;
  enum?: Array<string>;
  properties?: Array<Property>;
  items?: TypeRef;
  minItems?: number;
  maxItems?: number;
}

export interface CommandDef {
  name: string;
  description?: string;
  experimental?: boolean;
  deprecated?: boolean;
  parameters?: Array<Property>;
  returns?: Array<Property>;
}

export interface EventDef {
  name: string;
  description?: string;
  experimental?: boolean;
  deprecated?: boolean;
  parameters?: Array<Property>;
}

export interface Property {
  name: string;
  type?: CDPType;
  $ref?: string;
  description?: string;
  optional?: boolean;
  experimental?: boolean;
  deprecated?: boolean;
  enum?: Array<string>;
  items?: TypeRef;
  minItems?: number;
  maxItems?: number;
}

export interface TypeRef {
  type?: CDPType;
  $ref?: string;
  items?: TypeRef;
}

export type CDPType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "any";
