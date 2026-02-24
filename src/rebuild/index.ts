/**
 * Rebuild-based layout engine.
 *
 * Phase 1: Topology Analyser — pure graph algorithms for analysis.
 * Phase 2: Rebuild Engine — core positioning algorithm.
 * Phase 3+ (containers, artifacts) will be added in subsequent iterations.
 */

// ── Flow graph extraction ──────────────────────────────────────────────────
export {
  type FlowNode,
  type FlowGraph,
  extractFlowGraph,
  extractFlowGraphFromElements,
  isFlowNode,
} from './topology';

// ── Back-edge (cycle) detection ────────────────────────────────────────────
export { detectBackEdges, getBackEdgeTargets } from './back-edges';

// ── Topological sort with layer assignment ─────────────────────────────────
export { type LayeredNode, topologicalSort, groupByLayer } from './topo-sort';

// ── Gateway fan-out and merge pattern detection ────────────────────────────
export { type GatewayPattern, detectGatewayPatterns } from './patterns';

// ── Container hierarchy ────────────────────────────────────────────────────
export {
  type ContainerNode,
  type ContainerHierarchy,
  buildContainerHierarchy,
  buildContainerHierarchyFromElements,
  getContainerRebuildOrder,
} from './containers';

// ── Boundary events and exception chains ───────────────────────────────────
export {
  type BoundaryEventInfo,
  identifyBoundaryEvents,
  identifyBoundaryEventsFromElements,
} from './boundary';

// ── Rebuild engine (Phase 2) ───────────────────────────────────────────────
export { type RebuildOptions, type RebuildResult, rebuildLayout } from './engine';

// ── Container layout utilities (Phase 3) ───────────────────────────────────
export { moveElementTo } from './container-layout';
