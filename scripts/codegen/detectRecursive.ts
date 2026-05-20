import type { Property, TypeDef, TypeRef } from "./types.js";

const refTarget = (
  ref: string,
  typeIds: ReadonlySet<string>,
): string | undefined => {
  if (typeIds.has(ref)) {
    return ref;
  }

  const localName = ref.includes(".")
    ? ref.slice(ref.lastIndexOf(".") + 1)
    : ref;
  return typeIds.has(localName) ? localName : undefined;
};

const collectTypeRefTargets = (
  typeRef: TypeRef | undefined,
  typeIds: ReadonlySet<string>,
): ReadonlyArray<string> => {
  if (typeRef === undefined) {
    return [];
  }

  const direct = typeRef.$ref === undefined ? [] : [typeRef.$ref];
  return [
    ...direct.flatMap((ref) => {
      const target = refTarget(ref, typeIds);
      return target === undefined ? [] : [target];
    }),
    ...collectTypeRefTargets(typeRef.items, typeIds),
  ];
};

const collectPropertyTargets = (
  property: Property,
  typeIds: ReadonlySet<string>,
): ReadonlyArray<string> => [
  ...collectTypeRefTargets(property, typeIds),
  ...collectTypeRefTargets(property.items, typeIds),
];

const collectTypeTargets = (
  type: TypeDef,
  typeIds: ReadonlySet<string>,
): ReadonlyArray<string> => [
  ...collectTypeRefTargets(type.items, typeIds),
  ...(type.properties ?? []).flatMap((property) =>
    collectPropertyTargets(property, typeIds),
  ),
];

const buildAdjacency = (
  types: ReadonlyArray<TypeDef>,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const typeIds = new Set(types.map((type) => type.id));
  return new Map(
    types.map(
      (type) => [type.id, new Set(collectTypeTargets(type, typeIds))] as const,
    ),
  );
};

const visit = (
  typeId: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  visiting: Set<string>,
  visited: Set<string>,
  path: ReadonlyArray<string>,
  recursive: Set<string>,
): void => {
  if (visiting.has(typeId)) {
    path
      .slice(path.indexOf(typeId))
      .forEach((cycleTypeId) => recursive.add(cycleTypeId));
    return;
  }
  if (visited.has(typeId)) {
    return;
  }

  visiting.add(typeId);
  [...(adjacency.get(typeId) ?? [])].forEach((target) => {
    visit(target, adjacency, visiting, visited, [...path, typeId], recursive);
  });
  visiting.delete(typeId);
  visited.add(typeId);
};

export function detectRecursive(
  types: ReadonlyArray<TypeDef>,
): ReadonlySet<string> {
  const adjacency = buildAdjacency(types);
  const recursive = new Set<string>();
  const visited = new Set<string>();
  [...adjacency.keys()].forEach((typeId) => {
    visit(typeId, adjacency, new Set(), visited, [], recursive);
  });
  return recursive;
}
