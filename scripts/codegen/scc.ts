export function tarjanSCC<T>(
  nodes: ReadonlyArray<T>,
  edges: (node: T) => ReadonlyArray<T>,
): ReadonlyArray<ReadonlyArray<T>> {
  let nextIndex = 0;
  const stack: Array<T> = [];
  const onStack = new Set<T>();
  const indices = new Map<T, number>();
  const lowLinks = new Map<T, number>();
  const components: Array<Array<T>> = [];

  const strongConnect = (node: T): void => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of edges(node)) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor);
        const nodeLowLink = lowLinks.get(node);
        const neighborLowLink = lowLinks.get(neighbor);
        if (nodeLowLink !== undefined && neighborLowLink !== undefined) {
          lowLinks.set(node, Math.min(nodeLowLink, neighborLowLink));
        }
      } else if (onStack.has(neighbor)) {
        const nodeLowLink = lowLinks.get(node);
        const neighborIndex = indices.get(neighbor);
        if (nodeLowLink !== undefined && neighborIndex !== undefined) {
          lowLinks.set(node, Math.min(nodeLowLink, neighborIndex));
        }
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component: Array<T> = [];
      let current: T | undefined;
      do {
        current = stack.pop();
        if (current !== undefined) {
          onStack.delete(current);
          component.push(current);
        }
      } while (current !== undefined && current !== node);
      components.push(component);
    }
  };

  for (const node of nodes) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  return components;
}
