/**
 * Back-edge (cycle/loop) detection for the rebuild-based layout engine.
 *
 * Implements DFS-based back-edge detection to identify edges that create
 * cycles in the flow graph.  These are skipped during the forward
 * topological pass and reconnected after all forward elements are placed.
 */

import type { FlowGraph } from './topology';

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
