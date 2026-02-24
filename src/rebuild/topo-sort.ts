/**
 * Topological sort with layer assignment for the rebuild-based layout engine.
 *
 * Computes a topological ordering of flow nodes (ignoring back-edges)
 * and assigns each node a layer (distance from start event).  This
 * determines the left-to-right rebuild order.
 *
 * Uses modified BFS (Kahn's algorithm) starting from start events.
 */

import type { FlowGraph, FlowNode } from './topology';

// ── Types ──────────────────────────────────────────────────────────────────

/** A node with its assigned layer in the topological ordering. */
export interface LayeredNode {
  /** The element ID. */
  elementId: string;
  /** Layer number (0 = start events, increases left-to-right). */
  layer: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute forward in-degree for each node (ignoring back-edges).
 */
function computeInDegrees(
  nodes: Map<string, FlowNode>,
  backEdgeIds: Set<string>
): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const [id] of nodes) {
    inDegree.set(id, 0);
  }
  for (const [, node] of nodes) {
    for (let i = 0; i < node.outgoing.length; i++) {
      if (backEdgeIds.has(node.outgoingFlowIds[i])) continue;
      const targetId = node.outgoing[i].element.id;
      inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
    }
  }
  return inDegree;
}

/**
 * Seed the BFS queue with nodes that have zero in-degree.
 * Falls back to graph-identified start nodes if none found.
 */
function seedQueue(
  nodes: Map<string, FlowNode>,
  inDegree: Map<string, number>,
  startNodeIds: string[]
): { queue: string[]; layer: Map<string, number> } {
  const layer = new Map<string, number>();
  const queue: string[] = [];

  for (const [id] of nodes) {
    if ((inDegree.get(id) || 0) === 0) {
      queue.push(id);
      layer.set(id, 0);
    }
  }

  if (queue.length === 0) {
    for (const startId of startNodeIds) {
      if (!layer.has(startId)) {
        queue.push(startId);
        layer.set(startId, 0);
      }
    }
  }

  return { queue, layer };
}

/**
 * Run BFS with longest-path layering.
 */
function bfsLayering(
  nodes: Map<string, FlowNode>,
  backEdgeIds: Set<string>,
  inDegree: Map<string, number>,
  queue: string[],
  layer: Map<string, number>
): void {
  const processed = new Set<string>();
  let head = 0;

  while (head < queue.length) {
    const currentId = queue[head++];
    if (processed.has(currentId)) continue;
    processed.add(currentId);

    const node = nodes.get(currentId)!;
    const currentLayer = layer.get(currentId) || 0;

    for (let i = 0; i < node.outgoing.length; i++) {
      if (backEdgeIds.has(node.outgoingFlowIds[i])) continue;
      const targetId = node.outgoing[i].element.id;
      const newLayer = currentLayer + 1;
      const existing = layer.get(targetId);
      if (existing === undefined || newLayer > existing) {
        layer.set(targetId, newLayer);
      }
      const newInDeg = (inDegree.get(targetId) || 1) - 1;
      inDegree.set(targetId, newInDeg);
      if (newInDeg <= 0 && !processed.has(targetId)) {
        queue.push(targetId);
      }
    }
  }

  // Assign layer 0 to any disconnected nodes
  for (const [id] of nodes) {
    if (!layer.has(id)) {
      layer.set(id, 0);
    }
  }
}

// ── Topological sort ───────────────────────────────────────────────────────

/**
 * Compute a topological ordering with layer assignment using Kahn's algorithm.
 *
 * Ignores back-edges (cycles) to produce a valid DAG ordering.
 * Each node is assigned a layer equal to the longest path from any
 * start node to it, ensuring that elements at the same "depth" share
 * a layer.
 *
 * Within each layer, nodes are sorted by their original Y position
 * to preserve the vertical ordering from imported diagrams.
 *
 * @param graph       The flow graph to sort.
 * @param backEdgeIds Set of connection IDs that are back-edges (to ignore).
 * @returns           Array of LayeredNode sorted by layer, then by Y position.
 */
export function topologicalSort(graph: FlowGraph, backEdgeIds: Set<string>): LayeredNode[] {
  const { nodes, startNodeIds } = graph;
  if (nodes.size === 0) return [];

  const inDegree = computeInDegrees(nodes, backEdgeIds);
  const { queue, layer } = seedQueue(nodes, inDegree, startNodeIds);
  bfsLayering(nodes, backEdgeIds, inDegree, queue, layer);

  // Build result array sorted by layer, then by original Y position
  const result: LayeredNode[] = [];
  for (const [id, layerNum] of layer) {
    result.push({ elementId: id, layer: layerNum });
  }

  result.sort((a, b) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    const aNode = nodes.get(a.elementId)!;
    const bNode = nodes.get(b.elementId)!;
    return aNode.element.y - bNode.element.y;
  });

  return result;
}

/**
 * Group layered nodes by their layer number.
 *
 * @returns Map of layer number → array of element IDs in that layer.
 */
export function groupByLayer(layeredNodes: LayeredNode[]): Map<number, string[]> {
  const groups = new Map<number, string[]>();

  for (const { elementId, layer } of layeredNodes) {
    if (!groups.has(layer)) {
      groups.set(layer, []);
    }
    groups.get(layer)!.push(elementId);
  }

  return groups;
}
