export interface RelayEdge {
  upstreamKey: string;
  downstreamKey: string;
}

export function findCycle(edges: RelayEdge[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.upstreamKey) ?? [];
    list.push(edge.downstreamKey);
    adjacency.set(edge.upstreamKey, list);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const walk = (node: string): string[] | null => {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const found = walk(next);
      if (found) return found;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const node of adjacency.keys()) {
    const found = walk(node);
    if (found) return found;
  }
  return null;
}
