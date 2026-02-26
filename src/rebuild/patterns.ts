/**
 * Gateway fan-out and merge pattern detection for the rebuild-based layout engine.
 *
 * For each split gateway (>1 outgoing), identifies its matching merge
 * gateway (if any) and records the branches between them.  This
 * information is needed for symmetric branch placement in the rebuild
 * engine.
 */

import type { FlowGraph, FlowNode } from './topology';

// ── Types ──────────────────────────────────────────────────────────────────

/** A split-merge gateway pattern (diamond or open fan). */
export interface GatewayPattern {
  /** ID of the split gateway (the one with >1 outgoing). */
  splitId: string;
  /** ID of the merge gateway (where branches reconverge), or null if open fan. */
  mergeId: string | null;
  /**
   * Branches between split and merge.  Each branch is an ordered
   * list of element IDs from the split's direct successor to the
   * merge's direct predecessor (exclusive of split and merge).
   */
  branches: string[][];
}

// ── Pattern detection ──────────────────────────────────────────────────────

/**
 * Identify gateway fan-out and merge patterns in the flow graph.
 *
 * For each split gateway (>1 outgoing edges, excluding back-edges),
 * attempts to find a matching merge gateway using forward reachability
 * analysis (convergence point).
 *
 * @param graph       The flow graph to analyse.
 * @param backEdgeIds Set of connection IDs that are back-edges (to ignore).
 * @returns           Array of detected gateway patterns.
 */
export function detectGatewayPatterns(
  graph: FlowGraph,
  backEdgeIds: Set<string>
): GatewayPattern[] {
  const patterns: GatewayPattern[] = [];
  const { nodes } = graph;

  // Find all split gateways: elements with >1 outgoing (excluding back-edges)
  for (const [id, node] of nodes) {
    const forwardOutgoing = getForwardOutgoing(node, backEdgeIds);
    if (forwardOutgoing.length < 2) continue;

    // Only consider gateways as split points
    if (!isGateway(node.element.type)) continue;

    const pattern = findMergePattern(id, forwardOutgoing, nodes, backEdgeIds);
    patterns.push(pattern);
  }

  return patterns;
}

/**
 * Get the forward (non-back-edge) outgoing neighbours of a node.
 */
function getForwardOutgoing(
  node: FlowNode,
  backEdgeIds: Set<string>
): Array<{ node: FlowNode; flowId: string }> {
  const result: Array<{ node: FlowNode; flowId: string }> = [];

  for (let i = 0; i < node.outgoing.length; i++) {
    const flowId = node.outgoingFlowIds[i];
    if (!backEdgeIds.has(flowId)) {
      result.push({ node: node.outgoing[i], flowId });
    }
  }

  return result;
}

/**
 * Check if an element type is a gateway.
 */
function isGateway(type: string): boolean {
  return (
    type === 'bpmn:ExclusiveGateway' ||
    type === 'bpmn:ParallelGateway' ||
    type === 'bpmn:InclusiveGateway' ||
    type === 'bpmn:EventBasedGateway' ||
    type === 'bpmn:ComplexGateway'
  );
}

/**
 * Find the merge point for a split gateway by tracing all branches
 * forward and finding where they converge.
 *
 * Uses the "balanced gateway" heuristic: the merge is the first node
 * reachable from ALL branches of the split.  This handles simple
 * diamond patterns (split → tasks → merge) and nested patterns.
 *
 * For "open fan" splits (branches that don't all reconverge), each
 * branch's element list is limited to elements EXCLUSIVELY reachable
 * from that branch.  Shared continuation elements (reachable from
 * multiple branches) fall through to `positionAfterPredecessor`.
 */
function findMergePattern(
  splitId: string,
  forwardOutgoing: Array<{ node: FlowNode; flowId: string }>,
  nodes: Map<string, FlowNode>,
  backEdgeIds: Set<string>
): GatewayPattern {
  // Trace each branch forward, collecting reachable node sets
  const branchReachable: Set<string>[] = [];

  for (const { node: startNode } of forwardOutgoing) {
    const reachable = new Set<string>();
    traceBranch(startNode, splitId, nodes, backEdgeIds, reachable, new Set());
    branchReachable.push(reachable);
  }

  // Find the merge point: first node reachable from ALL branches
  // that is a gateway (or the first common convergence point)
  let mergeId: string | null = null;

  if (branchReachable.length > 0) {
    // Candidates: nodes reachable from the first branch
    const candidates = [...branchReachable[0]];

    // Filter to nodes reachable from ALL branches
    const commonReachable = candidates.filter((id) =>
      branchReachable.every((reachable) => reachable.has(id))
    );

    // The merge is the "closest" common node — the one with the
    // shortest max-distance from any branch start.
    // Simple heuristic: prefer gateways, then pick the first one
    // encountered in topological order (smallest layer).
    if (commonReachable.length > 0) {
      // Prefer gateways as merge points
      const gatewayMerge = commonReachable.find((id) => {
        const node = nodes.get(id);
        return node && isGateway(node.element.type);
      });

      mergeId = gatewayMerge ?? commonReachable[0];
    }
  }

  if (mergeId !== null) {
    // Closed fan: build branch element lists stopping at the merge gateway
    const branches: string[][] = [];
    for (const { node: startNode } of forwardOutgoing) {
      const branch: string[] = [];
      collectBranchElements(
        startNode.element.id,
        splitId,
        mergeId,
        nodes,
        backEdgeIds,
        branch,
        new Set()
      );
      branches.push(branch);
    }
    return { splitId, mergeId, branches };
  }

  // Open fan: no common convergence point across all branches.
  // Only include elements EXCLUSIVELY reachable from each branch
  // (not reachable from any other branch).  Shared elements (e.g.
  // the continuation after a partial merge) are excluded from all
  // branch lists so they fall through to positionAfterPredecessor.
  const branches: string[][] = forwardOutgoing.map((_, i) => {
    return [...branchReachable[i]].filter(
      (id) => !branchReachable.some((reachable, j) => j !== i && reachable.has(id))
    );
  });

  return { splitId, mergeId: null, branches };
}

/**
 * Trace a branch forward from a start node, collecting all reachable nodes.
 * Stops at the split node (avoids looping back) and respects back-edges.
 */
function traceBranch(
  startNode: FlowNode,
  splitId: string,
  nodes: Map<string, FlowNode>,
  backEdgeIds: Set<string>,
  reachable: Set<string>,
  visited: Set<string>
): void {
  const stack = [startNode.element.id];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (visited.has(currentId)) continue;
    if (currentId === splitId) continue; // Don't loop back to split
    visited.add(currentId);
    reachable.add(currentId);

    const node = nodes.get(currentId);
    if (!node) continue;

    for (let i = 0; i < node.outgoing.length; i++) {
      const flowId = node.outgoingFlowIds[i];
      if (backEdgeIds.has(flowId)) continue;
      const targetId = node.outgoing[i].element.id;
      if (!visited.has(targetId) && targetId !== splitId) {
        stack.push(targetId);
      }
    }
  }
}

/**
 * Collect elements on a single branch between split and merge.
 * Stops at the merge gateway (exclusive) or at any already-visited node.
 */
function collectBranchElements(
  currentId: string,
  splitId: string,
  mergeId: string | null,
  nodes: Map<string, FlowNode>,
  backEdgeIds: Set<string>,
  branch: string[],
  visited: Set<string>
): void {
  if (visited.has(currentId)) return;
  if (currentId === splitId) return;
  if (currentId === mergeId) return; // Stop at merge (exclusive)
  visited.add(currentId);
  branch.push(currentId);

  const node = nodes.get(currentId);
  if (!node) return;

  for (let i = 0; i < node.outgoing.length; i++) {
    const flowId = node.outgoingFlowIds[i];
    if (backEdgeIds.has(flowId)) continue;
    const targetId = node.outgoing[i].element.id;
    collectBranchElements(targetId, splitId, mergeId, nodes, backEdgeIds, branch, visited);
  }
}
