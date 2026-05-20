import type { CommandDef, Domain, EventDef, Protocol, TypeDef } from "./types.js";

const compareText = (left: string, right: string): number => left.localeCompare(right, "en");

const sortTypes = (types: Array<TypeDef>): Array<TypeDef> =>
  [...types].sort((left, right) => compareText(left.id, right.id));

const sortCommands = (commands: Array<CommandDef>): Array<CommandDef> =>
  [...commands].sort((left, right) => compareText(left.name, right.name));

const sortEvents = (events: Array<EventDef>): Array<EventDef> =>
  [...events].sort((left, right) => compareText(left.name, right.name));

const sortDomain = (domain: Domain): Domain => ({
  ...domain,
  types: sortTypes(domain.types),
  commands: sortCommands(domain.commands),
  events: sortEvents(domain.events),
});

export function sortProtocol(protocol: Protocol): Protocol {
  return {
    domains: protocol.domains
      .map(sortDomain)
      .sort((left, right) => compareText(left.domain, right.domain)),
  };
}
