/**
 * Rebuild-based layout engine — core positioning algorithm.
 *
 * Repositions existing diagram elements using a topology-driven
 * forward pass.  Elements are moved (not recreated) to preserve
 * all business properties, IDs, and connections.
 *
 * Algorithm:
 *   1. Build container hierarchy and process inside-out
 *   2. Per container: extract flow graph and detect back-edges
 *   3. Topological sort with layer assignment
 *   4. Detect gateway split/merge patterns
 *   5. Forward pass: compute target positions left-to-right
 *   6. Apply positions via modeling.moveElements
 *   7. Position boundary events and exception chains
 *   8. Resize expanded subprocesses to fit contents
 *   9. Layout all connections (forward flows + back-edges + exception chains)
 *   10. Stack pools vertically for collaborations
 */

import type { DiagramState } from '../types';
import { type BpmnElement, type ElementRegistry, type Modeling, getService } from '../bpmn-types';
import { STANDARD_BPMN_GAP } from '../constants';
import { extractFlowGraph, type FlowGraph } from './topology';
import { detectBackEdges } from './back-edges';
import { topologicalSort } from './topo-sort';
import { detectGatewayPatterns } from './patterns';
import { buildContainerHierarchy, getContainerRebuildOrder } from './containers';
import { identifyBoundaryEvents } from './boundary';
import {
  moveElementTo,
  collectExceptionChainIds,
  positionBoundaryEventsAndChains,
  resizeSubprocessToFit,
  stackPools,
  layoutMessageFlows,
} from './container-layout';
import { buildPatternLookups, computePositions } from './positioning';

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

/**
 * Padding (px) inside an expanded subprocess around its internal
 * elements.  Applied on all four sides.
 */
const SUBPROCESS_PADDING = 40;

/** Gap (px) between stacked participant pools. */
const POOL_GAP = 68;

// ── Main rebuild function ──────────────────────────────────────────────────

/**
 * Rebuild the layout of a diagram by repositioning elements using
 * topology-driven placement.
 *
 * Does NOT create or delete elements — only moves them.  All business
 * properties, IDs, and connections are preserved.
 *
 * Handles containers (subprocesses, participants) by rebuilding
 * inside-out: deepest containers first, then their parents.
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

  // Build container hierarchy for recursive processing
  const hierarchy = buildContainerHierarchy(registry);
  const rebuildOrder = getContainerRebuildOrder(hierarchy);

  let totalRepositioned = 0;
  let totalRerouted = 0;

  // Track which participants we've rebuilt (for pool stacking)
  const rebuiltParticipants: BpmnElement[] = [];

  // Process containers inside-out (deepest first)
  for (const containerNode of rebuildOrder) {
    const container = containerNode.element;

    // Skip Collaboration root — it doesn't hold flow nodes directly
    if (container.type === 'bpmn:Collaboration') continue;

    // Use subprocess-internal origin for subprocesses
    const containerOrigin =
      container.type === 'bpmn:SubProcess' ? { x: SUBPROCESS_PADDING + 18, y: origin.y } : origin;

    const result = rebuildContainer(
      registry,
      modeling,
      container,
      containerOrigin,
      gap,
      branchSpacing
    );

    totalRepositioned += result.repositionedCount;
    totalRerouted += result.reroutedCount;

    // Resize expanded subprocesses to fit their contents
    if (container.type === 'bpmn:SubProcess' && containerNode.isExpanded) {
      resizeSubprocessToFit(modeling, registry, container, SUBPROCESS_PADDING);
    }

    // Track participants for pool stacking
    if (container.type === 'bpmn:Participant') {
      rebuiltParticipants.push(container);
    }
  }

  // Stack pools vertically for collaborations
  if (rebuiltParticipants.length > 1) {
    totalRepositioned += stackPools(rebuiltParticipants, modeling, POOL_GAP);
  }

  // Layout message flows after all pools are positioned
  totalRerouted += layoutMessageFlows(registry, modeling);

  return { repositionedCount: totalRepositioned, reroutedCount: totalRerouted };
}

// ── Container rebuild ──────────────────────────────────────────────────────

/**
 * Rebuild the layout of a single container scope (Process, Participant,
 * or SubProcess).  Positions flow nodes, boundary events, and exception
 * chains within the container.
 */
function rebuildContainer(
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement,
  origin: { x: number; y: number },
  gap: number,
  branchSpacing: number
): RebuildResult {
  // Extract flow graph scoped to this container
  const graph = extractFlowGraph(registry, container);
  if (graph.nodes.size === 0) {
    return { repositionedCount: 0, reroutedCount: 0 };
  }

  // Identify boundary events and collect exception chain IDs to skip
  const boundaryInfos = identifyBoundaryEvents(registry, container);
  const exceptionChainIds = collectExceptionChainIds(boundaryInfos);

  // Topology analysis
  const backEdgeIds = detectBackEdges(graph);
  const sorted = topologicalSort(graph, backEdgeIds);
  const patterns = detectGatewayPatterns(graph, backEdgeIds);
  const { mergeToPattern, elementToBranch } = buildPatternLookups(patterns);

  // Compute positions (skipping exception chain elements)
  const positions = computePositions(
    graph,
    sorted,
    backEdgeIds,
    mergeToPattern,
    elementToBranch,
    origin,
    gap,
    branchSpacing,
    exceptionChainIds
  );

  // Apply positions
  let repositionedCount = 0;
  for (const [id, target] of positions) {
    const element = registry.get(id);
    if (!element) continue;
    if (moveElementTo(modeling, element, target)) {
      repositionedCount++;
    }
  }

  // Layout main flow connections
  let reroutedCount = layoutConnections(graph, backEdgeIds, registry, modeling);

  // Position boundary events and exception chains
  const boundaryResult = positionBoundaryEventsAndChains(
    boundaryInfos,
    positions,
    registry,
    modeling,
    gap
  );
  repositionedCount += boundaryResult.repositionedCount;
  reroutedCount += boundaryResult.reroutedCount;

  return { repositionedCount, reroutedCount };
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
