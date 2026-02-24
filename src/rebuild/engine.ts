/**
 * Rebuild-based layout engine — core positioning algorithm.
 *
 * Repositions existing diagram elements using a topology-driven
 * forward pass.  Elements are moved (not recreated) to preserve
 * all business properties, IDs, and connections.
 *
 * Algorithm:
 *   1. Extract flow graph and detect back-edges (Phase 1 topology)
 *   2. Topological sort with layer assignment
 *   3. Detect gateway split/merge patterns
 *   4. Forward pass: compute target positions left-to-right
 *   5. Apply positions via modeling.moveElements
 *   6. Layout all connections (forward flows + back-edges)
 *
 * Phase 2: handles linear chains, gateway splits/merges, and back-edges.
 * Phase 3+ will add container (subprocess/pool/lane) support.
 */

import type { DiagramState } from '../types';
import { type BpmnElement, type ElementRegistry, type Modeling, getService } from '../bpmn-types';
import { STANDARD_BPMN_GAP } from '../constants';
import { extractFlowGraph, type FlowGraph, type FlowNode } from './topology';
import { detectBackEdges } from './back-edges';
import { topologicalSort, type LayeredNode } from './topo-sort';
import { detectGatewayPatterns, type GatewayPattern } from './patterns';

// ── Types ──────────────────────────────────────────────────────────────────

/** Options for the rebuild layout engine. */
export interface RebuildOptions {
  /** Origin position for the first start event (center coordinates). */
  origin?: { x: number; y: number };
  /** Edge-to-edge gap between consecutive elements (default: 50). */
  gap?: number;
  /**
   * Vertical centre-to-centre spacing between gateway branches.
   * Default: 130 (task height 80 + standard gap 50).
   */
  branchSpacing?: number;
}

/** Result returned by the rebuild layout engine. */
export interface RebuildResult {
  /** Number of elements repositioned. */
  repositionedCount: number;
  /** Number of connections re-routed. */
  reroutedCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Default origin for the first start event (center coordinates). */
const DEFAULT_ORIGIN = { x: 180, y: 200 };

/**
 * Default vertical centre-to-centre spacing between gateway branches.
 * Matches typical BPMN layout: task height (80) + standard gap (50).
 */
const DEFAULT_BRANCH_SPACING = 130;

// ── Main rebuild function ──────────────────────────────────────────────────

/**
 * Rebuild the layout of a diagram by repositioning elements using
 * topology-driven placement.
 *
 * Does NOT create or delete elements — only moves them.  All business
 * properties, IDs, and connections are preserved.
 *
 * @param diagram  The diagram state to rebuild.
 * @param options  Optional configuration for origin, gap, and branch spacing.
 * @returns        Summary of repositioned elements and re-routed connections.
 */
export function rebuildLayout(diagram: DiagramState, options?: RebuildOptions): RebuildResult {
  const modeler = diagram.modeler;
  const modeling = getService(modeler, 'modeling');
  const registry = getService(modeler, 'elementRegistry');

  const origin = options?.origin ?? DEFAULT_ORIGIN;
  const gap = options?.gap ?? STANDARD_BPMN_GAP;
  const branchSpacing = options?.branchSpacing ?? DEFAULT_BRANCH_SPACING;

  // ── Phase 1: topology analysis ─────────────────────────────────────────

  const graph = extractFlowGraph(registry);
  if (graph.nodes.size === 0) {
    return { repositionedCount: 0, reroutedCount: 0 };
  }

  const backEdgeIds = detectBackEdges(graph);
  const sorted = topologicalSort(graph, backEdgeIds);
  const patterns = detectGatewayPatterns(graph, backEdgeIds);

  // ── Build pattern lookup tables ────────────────────────────────────────

  const { mergeToPattern, elementToBranch } = buildPatternLookups(patterns);

  // ── Forward pass: compute target positions ─────────────────────────────

  const positions = computePositions(
    graph,
    sorted,
    backEdgeIds,
    mergeToPattern,
    elementToBranch,
    origin,
    gap,
    branchSpacing
  );

  // ── Apply positions ────────────────────────────────────────────────────

  let repositionedCount = 0;
  for (const [id, target] of positions) {
    const element = registry.get(id);
    if (!element) continue;
    if (moveElementTo(modeling, element, target)) {
      repositionedCount++;
    }
  }

  // ── Layout connections ─────────────────────────────────────────────────

  const reroutedCount = layoutConnections(graph, backEdgeIds, registry, modeling);

  return { repositionedCount, reroutedCount };
}

// ── Pattern lookup construction ────────────────────────────────────────────

/** Build merge-gateway and branch-element lookup tables from patterns. */
function buildPatternLookups(patterns: GatewayPattern[]): {
  mergeToPattern: Map<string, GatewayPattern>;
  elementToBranch: Map<string, { pattern: GatewayPattern; branchIndex: number }>;
} {
  const mergeToPattern = new Map<string, GatewayPattern>();
  const elementToBranch = new Map<string, { pattern: GatewayPattern; branchIndex: number }>();

  for (const pattern of patterns) {
    if (pattern.mergeId) {
      mergeToPattern.set(pattern.mergeId, pattern);
    }
    for (let bi = 0; bi < pattern.branches.length; bi++) {
      for (const id of pattern.branches[bi]) {
        elementToBranch.set(id, { pattern, branchIndex: bi });
      }
    }
  }

  return { mergeToPattern, elementToBranch };
}

// ── Position computation ───────────────────────────────────────────────────

/**
 * Compute target center positions for all elements in the flow graph.
 *
 * Elements are positioned in topological order:
 * - Start nodes at the origin column
 * - Branch elements with symmetric vertical offset
 * - Merge gateways aligned after all branches
 * - Other elements to the right of their predecessor
 */
function computePositions(
  graph: FlowGraph,
  sorted: LayeredNode[],
  backEdgeIds: Set<string>,
  mergeToPattern: Map<string, GatewayPattern>,
  elementToBranch: Map<string, { pattern: GatewayPattern; branchIndex: number }>,
  origin: { x: number; y: number },
  gap: number,
  branchSpacing: number
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Pre-place start nodes at the origin column, stacked vertically
  let startY = origin.y;
  for (const startId of graph.startNodeIds) {
    if (graph.nodes.has(startId)) {
      positions.set(startId, { x: origin.x, y: startY });
      startY += branchSpacing;
    }
  }

  // Process remaining elements in topological order
  for (const { elementId } of sorted) {
    if (positions.has(elementId)) continue;

    const node = graph.nodes.get(elementId);
    if (!node) continue;

    if (mergeToPattern.has(elementId)) {
      positionMerge(positions, mergeToPattern.get(elementId)!, node.element, gap, graph);
    } else if (elementToBranch.has(elementId)) {
      const { pattern, branchIndex } = elementToBranch.get(elementId)!;
      positionBranchElement(
        positions,
        pattern,
        branchIndex,
        elementId,
        node.element,
        gap,
        branchSpacing,
        graph
      );
    } else {
      positionAfterPredecessor(positions, node, node.element, gap, backEdgeIds);
    }
  }

  return positions;
}

/**
 * Position an element to the right of its rightmost positioned predecessor,
 * at the same Y as that predecessor.  Ignores back-edge predecessors.
 */
function positionAfterPredecessor(
  positions: Map<string, { x: number; y: number }>,
  node: FlowNode,
  element: BpmnElement,
  gap: number,
  backEdgeIds: Set<string>
): void {
  // Collect positioned forward predecessors
  const predecessors: Array<{ element: BpmnElement; pos: { x: number; y: number } }> = [];
  for (let i = 0; i < node.incoming.length; i++) {
    if (backEdgeIds.has(node.incomingFlowIds[i])) continue;
    const predId = node.incoming[i].element.id;
    const pos = positions.get(predId);
    if (pos) {
      predecessors.push({ element: node.incoming[i].element, pos });
    }
  }

  if (predecessors.length === 0) {
    // Fallback for disconnected elements
    positions.set(element.id, { x: DEFAULT_ORIGIN.x, y: DEFAULT_ORIGIN.y });
    return;
  }

  // Use the rightmost predecessor for X placement and Y alignment
  let best = predecessors[0];
  let maxRight = best.pos.x + best.element.width / 2;
  for (const p of predecessors) {
    const rightEdge = p.pos.x + p.element.width / 2;
    if (rightEdge > maxRight) {
      maxRight = rightEdge;
      best = p;
    }
  }

  positions.set(element.id, {
    x: maxRight + gap + element.width / 2,
    y: best.pos.y,
  });
}

/**
 * Position a branch element with symmetric vertical offset from the
 * split gateway.
 *
 * Vertical offsets for N branches (centered on split gateway Y):
 *   2 branches → ±branchSpacing/2
 *   3 branches → -branchSpacing, 0, +branchSpacing
 *   N branches → (i - (N-1)/2) * branchSpacing
 */
function positionBranchElement(
  positions: Map<string, { x: number; y: number }>,
  pattern: GatewayPattern,
  branchIndex: number,
  elementId: string,
  element: BpmnElement,
  gap: number,
  branchSpacing: number,
  graph: FlowGraph
): void {
  const splitPos = positions.get(pattern.splitId);
  if (!splitPos) {
    positions.set(elementId, { x: DEFAULT_ORIGIN.x, y: DEFAULT_ORIGIN.y });
    return;
  }

  // Symmetric branch Y offset
  const numBranches = pattern.branches.length;
  const branchOffset = (branchIndex - (numBranches - 1) / 2) * branchSpacing;
  const branchY = splitPos.y + branchOffset;

  // X based on position within the branch
  const branch = pattern.branches[branchIndex];
  const indexInBranch = branch.indexOf(elementId);

  let prevRight: number;
  if (indexInBranch <= 0) {
    // First element in branch: predecessor is the split gateway
    const splitNode = graph.nodes.get(pattern.splitId);
    prevRight = splitPos.x + (splitNode?.element.width ?? 50) / 2;
  } else {
    // Previous element in the same branch
    const prevId = branch[indexInBranch - 1];
    const prevPos = positions.get(prevId);
    const prevNode = graph.nodes.get(prevId);
    prevRight = (prevPos?.x ?? splitPos.x) + (prevNode?.element.width ?? 100) / 2;
  }

  positions.set(elementId, {
    x: prevRight + gap + element.width / 2,
    y: branchY,
  });
}

/**
 * Position a merge gateway after all branches of its split pattern.
 *
 * X: to the right of the rightmost branch endpoint + gap.
 * Y: same as the split gateway (centered between branches).
 */
function positionMerge(
  positions: Map<string, { x: number; y: number }>,
  pattern: GatewayPattern,
  element: BpmnElement,
  gap: number,
  graph: FlowGraph
): void {
  const splitPos = positions.get(pattern.splitId);
  if (!splitPos) {
    positions.set(element.id, { x: DEFAULT_ORIGIN.x, y: DEFAULT_ORIGIN.y });
    return;
  }

  // Find the maximum right edge across all branch endpoints
  const splitNode = graph.nodes.get(pattern.splitId);
  let maxRight = splitPos.x + (splitNode?.element.width ?? 50) / 2;

  for (const branch of pattern.branches) {
    if (branch.length > 0) {
      const lastId = branch[branch.length - 1];
      const lastPos = positions.get(lastId);
      const lastNode = graph.nodes.get(lastId);
      if (lastPos && lastNode) {
        const rightEdge = lastPos.x + lastNode.element.width / 2;
        if (rightEdge > maxRight) maxRight = rightEdge;
      }
    }
  }

  positions.set(element.id, {
    x: maxRight + gap + element.width / 2,
    y: splitPos.y,
  });
}

// ── Element movement ───────────────────────────────────────────────────────

/**
 * Move an element so its centre is at the given target position.
 * Returns true if the element was actually moved (delta ≥ 1px).
 */
function moveElementTo(
  modeling: Modeling,
  element: BpmnElement,
  targetCenter: { x: number; y: number }
): boolean {
  const currentCenterX = element.x + element.width / 2;
  const currentCenterY = element.y + element.height / 2;

  const dx = Math.round(targetCenter.x - currentCenterX);
  const dy = Math.round(targetCenter.y - currentCenterY);

  if (dx === 0 && dy === 0) return false;

  modeling.moveElements([element], { x: dx, y: dy });
  return true;
}

// ── Connection layout ──────────────────────────────────────────────────────

/**
 * Re-layout all sequence flow connections after element repositioning.
 * Forward flows are laid out first, then back-edges (loops).
 *
 * Uses bpmn-js ManhattanLayout via modeling.layoutConnection() which
 * computes orthogonal waypoints based on element positions.
 */
function layoutConnections(
  graph: FlowGraph,
  backEdgeIds: Set<string>,
  registry: ElementRegistry,
  modeling: Modeling
): number {
  let count = 0;

  // Layout forward connections first
  for (const [, node] of graph.nodes) {
    for (let i = 0; i < node.outgoing.length; i++) {
      const flowId = node.outgoingFlowIds[i];
      if (backEdgeIds.has(flowId)) continue;
      const conn = registry.get(flowId);
      if (conn) {
        modeling.layoutConnection(conn);
        count++;
      }
    }
  }

  // Layout back-edge connections (loops)
  for (const flowId of backEdgeIds) {
    const conn = registry.get(flowId);
    if (conn) {
      modeling.layoutConnection(conn);
      count++;
    }
  }

  return count;
}
