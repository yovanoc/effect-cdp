import { tarjanSCC } from "./scc.js";
import type {
  CommandDef,
  Domain,
  EventDef,
  Property,
  Protocol,
  TypeDef,
  TypeRef,
} from "./types.js";

export interface ResolvedProtocol {
  readonly byDomain: ReadonlyMap<string, ResolvedDomain>;
  readonly sharedExtracted: ReadonlyArray<{
    domain: string;
    type: TypeDef;
    reason: string;
  }>;
  readonly diagnostics: ReadonlyArray<{
    extracted: ReadonlyArray<TypeDef>;
    reason: string;
  }>;
  readonly domainsInCycle: ReadonlySet<string>;
}

export interface ResolvedDomain {
  readonly domain: Domain;
  readonly imports: ReadonlyArray<{ from: string; name: string }>;
}

interface ResolvedType {
  readonly domain: string;
  readonly type: TypeDef;
}

interface QualifiedRef {
  readonly domain: string;
  readonly typeId: string;
  readonly nodeId: string;
}

interface CrossDomainRef {
  readonly fromDomain: string;
  readonly targetDomain: string;
  readonly targetTypeId: string;
  readonly targetNodeId: string;
  readonly sourceNodeId?: string;
}

const compareText = (left: string, right: string): number =>
  left.localeCompare(right, "en");

const typeNodeId = (domain: string, typeId: string): string =>
  `${domain}.${typeId}`;

const qualifyRef = (currentDomain: string, ref: string): QualifiedRef => {
  const separator = ref.indexOf(".");
  if (separator === -1) {
    return {
      domain: currentDomain,
      typeId: ref,
      nodeId: typeNodeId(currentDomain, ref),
    };
  }
  const domain = ref.slice(0, separator);
  const typeId = ref.slice(separator + 1);
  return {
    domain,
    typeId,
    nodeId: typeNodeId(domain, typeId),
  };
};

const collectTypeRefRefs = (
  typeRef: TypeRef | undefined,
  refs: Array<string>,
): void => {
  if (typeRef === undefined) {
    return;
  }
  if (typeRef.$ref !== undefined) {
    refs.push(typeRef.$ref);
  }
  collectTypeRefRefs(typeRef.items, refs);
};

const collectPropertyRefs = (property: Property, refs: Array<string>): void => {
  if (property.$ref !== undefined) {
    refs.push(property.$ref);
  }
  collectTypeRefRefs(property.items, refs);
};

const collectPropertiesRefs = (
  properties: ReadonlyArray<Property> | undefined,
  refs: Array<string>,
): void => {
  if (properties === undefined) {
    return;
  }
  for (const property of properties) {
    collectPropertyRefs(property, refs);
  }
};

const collectTypeRefs = (type: TypeDef): ReadonlyArray<string> => {
  const refs: Array<string> = [];
  collectPropertiesRefs(type.properties, refs);
  collectTypeRefRefs(type.items, refs);
  return refs;
};

const collectCommandRefs = (command: CommandDef): ReadonlyArray<string> => {
  const refs: Array<string> = [];
  collectPropertiesRefs(command.parameters, refs);
  collectPropertiesRefs(command.returns, refs);
  return refs;
};

const collectEventRefs = (event: EventDef): ReadonlyArray<string> => {
  const refs: Array<string> = [];
  collectPropertiesRefs(event.parameters, refs);
  return refs;
};

const buildTypeIndex = (
  protocol: Protocol,
): ReadonlyMap<string, ResolvedType> => {
  const byNode = new Map<string, ResolvedType>();
  for (const domain of protocol.domains) {
    for (const type of domain.types) {
      byNode.set(typeNodeId(domain.domain, type.id), {
        domain: domain.domain,
        type,
      });
    }
  }
  return byNode;
};

const addCrossDomainRef = (
  refs: Array<CrossDomainRef>,
  typeIndex: ReadonlyMap<string, ResolvedType>,
  fromDomain: string,
  ref: string,
  sourceNodeId?: string,
): void => {
  const qualified = qualifyRef(fromDomain, ref);
  if (qualified.domain === fromDomain || !typeIndex.has(qualified.nodeId)) {
    return;
  }
  refs.push({
    fromDomain,
    targetDomain: qualified.domain,
    targetTypeId: qualified.typeId,
    targetNodeId: qualified.nodeId,
    ...(sourceNodeId === undefined ? {} : { sourceNodeId }),
  });
};

const collectCrossDomainRefs = (
  protocol: Protocol,
  typeIndex: ReadonlyMap<string, ResolvedType>,
): ReadonlyArray<CrossDomainRef> => {
  const refs: Array<CrossDomainRef> = [];
  for (const domain of protocol.domains) {
    for (const type of domain.types) {
      const sourceNodeId = typeNodeId(domain.domain, type.id);
      for (const ref of collectTypeRefs(type)) {
        addCrossDomainRef(refs, typeIndex, domain.domain, ref, sourceNodeId);
      }
    }
    for (const command of domain.commands) {
      for (const ref of collectCommandRefs(command)) {
        addCrossDomainRef(refs, typeIndex, domain.domain, ref);
      }
    }
    for (const event of domain.events) {
      for (const ref of collectEventRefs(event)) {
        addCrossDomainRef(refs, typeIndex, domain.domain, ref);
      }
    }
  }
  return refs;
};

const buildGraph = (
  refs: ReadonlyArray<CrossDomainRef>,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const edgeSets = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (ref.sourceNodeId === undefined) {
      continue;
    }
    const edges = edgeSets.get(ref.sourceNodeId) ?? new Set<string>();
    edges.add(ref.targetNodeId);
    edgeSets.set(ref.sourceNodeId, edges);
  }

  const graph = new Map<string, ReadonlyArray<string>>();
  for (const [nodeId, edges] of edgeSets) {
    graph.set(nodeId, [...edges].sort(compareText));
  }
  return graph;
};

const componentReason = (component: ReadonlyArray<string>): string =>
  `Cross-domain cycle: ${[...component].sort(compareText).join(" -> ")}`;

const extractedComponents = (
  nodes: ReadonlyArray<string>,
  graph: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<ReadonlyArray<string>> =>
  tarjanSCC(nodes, (node) => graph.get(node) ?? []).filter((component) => {
    if (component.length > 1) {
      return true;
    }
    const node = component[0];
    return node !== undefined && (graph.get(node) ?? []).includes(node);
  });

const buildSharedExtracted = (
  components: ReadonlyArray<ReadonlyArray<string>>,
  typeIndex: ReadonlyMap<string, ResolvedType>,
): ReadonlyArray<{ domain: string; type: TypeDef; reason: string }> => {
  const extracted: Array<{ domain: string; type: TypeDef; reason: string }> =
    [];
  for (const component of components) {
    const reason = componentReason(component);
    for (const nodeId of component) {
      const resolved = typeIndex.get(nodeId);
      if (resolved !== undefined) {
        extracted.push({
          domain: resolved.domain,
          type: resolved.type,
          reason,
        });
      }
    }
  }
  return extracted.sort((left, right) =>
    compareText(
      typeNodeId(left.domain, left.type.id),
      typeNodeId(right.domain, right.type.id),
    ),
  );
};

const buildDiagnostics = (
  components: ReadonlyArray<ReadonlyArray<string>>,
  typeIndex: ReadonlyMap<string, ResolvedType>,
): ReadonlyArray<{ extracted: ReadonlyArray<TypeDef>; reason: string }> =>
  components
    .map((component) => ({
      extracted: [...component].sort(compareText).flatMap((nodeId) => {
        const resolved = typeIndex.get(nodeId);
        return resolved === undefined ? [] : [resolved.type];
      }),
      reason: componentReason(component),
    }))
    .sort((left, right) => compareText(left.reason, right.reason));

const buildDomainImports = (
  domain: Domain,
  refs: ReadonlyArray<CrossDomainRef>,
  extractedNodeIds: ReadonlySet<string>,
): ReadonlyArray<{ from: string; name: string }> => {
  const imports = new Map<string, { from: string; name: string }>();
  for (const ref of refs) {
    if (
      ref.fromDomain !== domain.domain ||
      extractedNodeIds.has(ref.targetNodeId)
    ) {
      continue;
    }
    const key = typeNodeId(ref.targetDomain, ref.targetTypeId);
    imports.set(key, { from: ref.targetDomain, name: ref.targetTypeId });
  }
  return [...imports.values()].sort((left, right) => {
    const fromOrder = compareText(left.from, right.from);
    return fromOrder === 0 ? compareText(left.name, right.name) : fromOrder;
  });
};

export function resolveRefs(protocol: Protocol): ResolvedProtocol {
  const typeIndex = buildTypeIndex(protocol);
  const nodes = [...typeIndex.keys()].sort(compareText);
  const crossDomainRefs = collectCrossDomainRefs(protocol, typeIndex);
  const graph = buildGraph(crossDomainRefs);
  const components = extractedComponents(nodes, graph);
  const sharedExtracted = buildSharedExtracted(components, typeIndex);
  const extractedNodeIds = new Set(
    sharedExtracted.map((entry) => typeNodeId(entry.domain, entry.type.id)),
  );
  const byDomain = new Map<string, ResolvedDomain>();

  for (const domain of protocol.domains) {
    byDomain.set(domain.domain, {
      domain,
      imports: buildDomainImports(domain, crossDomainRefs, extractedNodeIds),
    });
  }

  // Build domain-level dependency graph from cross-domain refs and run SCC.
  // Any domain that participates in an SCC of size >= 2 (or self-loop) is
  // "in a cycle" for module-init purposes — refs across such domains must
  // be wrapped in Schema.suspend to avoid ReferenceError at import time.
  const domainEdgeSets = new Map<string, Set<string>>();
  for (const ref of crossDomainRefs) {
    if (extractedNodeIds.has(ref.targetNodeId)) {
      continue;
    }
    const edges = domainEdgeSets.get(ref.fromDomain) ?? new Set<string>();
    edges.add(ref.targetDomain);
    domainEdgeSets.set(ref.fromDomain, edges);
  }
  const domainNodes = protocol.domains.map((d) => d.domain).sort(compareText);
  const domainEdges = (node: string): ReadonlyArray<string> =>
    [...(domainEdgeSets.get(node) ?? [])].sort(compareText);
  const domainsInCycle = new Set<string>();
  for (const component of tarjanSCC(domainNodes, domainEdges)) {
    const isCycle =
      component.length > 1 ||
      (component.length === 1 &&
        component[0] !== undefined &&
        (domainEdgeSets.get(component[0]) ?? new Set()).has(component[0]));
    if (isCycle) {
      for (const node of component) {
        domainsInCycle.add(node);
      }
    }
  }

  return {
    byDomain,
    sharedExtracted,
    diagnostics: buildDiagnostics(components, typeIndex),
    domainsInCycle,
  };
}
