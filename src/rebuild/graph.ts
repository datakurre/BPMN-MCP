/**
 * Graph algorithms for the rebuild-based layout engine.
 *
 * Provides back-edge (cycle/loop) detection using DFS, and topological sort
 * with layer assignment using Kahn's BFS algorithm.
 *
 * Merged from: back-edges.ts + topo-sort.ts
 */

import type { FlowGraph, FlowNode } from './topology';

/**
 * Detect back-edges in a flow graph using DFS.
 *
 * A back-edge is a sequence flow that connects a node to an ancestor
 * on the current DFS path, creating a cycle (loop).  These must be
 * excluded from the topological sort to avoid infinite loops.
 *
 * Starts DFS from start nodes (no incoming edges) first to ensure the
 * DFS tree follows the natural forward flow, making loop-back edges
 * the ones detected as back-edges.
 *
 * @param graph  The flow graph to analyse.
 * @returns      Set of sequence flow connection IDs that are back-edges.
 */
export function detectBackEdges(graph: FlowGraph): Set<string> {
  const backEdgeIds = new Set<string>();
  const { nodes, startNodeIds } = graph;

  if (nodes.size === 0) return backEdgeIds;

  // DFS state: 0 = unvisited, 1 = in-progress (on stack), 2 = done
  const state = new Map<string, number>();
  for (const id of nodes.keys()) {
    state.set(id, 0);
  }

  function dfs(nodeId: string): void {
    state.set(nodeId, 1); // in-progress

    const node = nodes.get(nodeId)!;
    for (let i = 0; i < node.outgoing.length; i++) {
      const target = node.outgoing[i];
      const flowId = node.outgoingFlowIds[i];
      const targetState = state.get(target.element.id);

      if (targetState === 1) {
        // Target is an ancestor on the current DFS path → back-edge
        backEdgeIds.add(flowId);
      } else if (targetState === 0) {
        dfs(target.element.id);
      }
    }

    state.set(nodeId, 2); // done
  }

  // Start DFS from start nodes first (natural forward direction)
  for (const startId of startNodeIds) {
    if (state.get(startId) === 0) {
      dfs(startId);
    }
  }

  // Then process any remaining unvisited nodes (disconnected components)
  for (const id of nodes.keys()) {
    if (state.get(id) === 0) {
      dfs(id);
    }
  }

  return backEdgeIds;
}

/**
 * Get the set of back-edge target node IDs (loop entry points).
 *
 * These are the nodes that receive a backward flow, i.e. where loops
 * re-enter the forward path.  Useful for identifying loop boundaries.
 */
export function getBackEdgeTargets(graph: FlowGraph, backEdgeIds: Set<string>): Set<string> {
  const targets = new Set<string>();

  for (const [, node] of graph.nodes) {
    for (let i = 0; i < node.outgoing.length; i++) {
      const flowId = node.outgoingFlowIds[i];
      if (backEdgeIds.has(flowId)) {
        targets.add(node.outgoing[i].element.id);
      }
    }
  }

  return targets;
}

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
