/**
 * Shared types for the ELK layout engine.
 */

import type { LayoutOptions, ElkNode } from 'elkjs';
import type { ElementRegistry, Modeling } from '../bpmn-types';
import type { LaneSnapshot } from './lane-layout';
import type { BoundaryEventSnapshot } from './boundary-save-restore';
import type { LayoutLogger } from './layout-logger';

/**
 * Typed ELK layout options for BPMN diagrams.
 *
 * ELK accepts all layout options as `LayoutOptions = Record<string, string>`
 * from elkjs.  This interface documents every ELK option key used by the
 * BPMN-MCP layout engine with its accepted values and purpose, providing
 * self-documentation and IDE autocomplete for the `ELK_LAYOUT_OPTIONS`
 * constant in `src/elk/constants.ts`.
 *
 * All values are strings because ELK's API only accepts strings.  Numeric
 * values are passed as `String(n)`, booleans as `'true'` / `'false'`.
 */
export interface BpmnElkOptions {
  'elk.algorithm'?: string;
  'elk.direction'?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  'elk.edgeRouting'?: 'ORTHOGONAL' | 'SPLINES' | 'POLYLINE' | 'UNDEFINED';
  'elk.spacing.nodeNode'?: string;
  'elk.spacing.edgeNode'?: string;
  'elk.spacing.componentComponent'?: string;
  'elk.layered.spacing.nodeNodeBetweenLayers'?: string;
  'elk.layered.spacing.edgeNodeBetweenLayers'?: string;
  'elk.layered.spacing.edgeEdgeBetweenLayers'?: string;
  'elk.layered.nodePlacement.strategy'?:
    | 'NETWORK_SIMPLEX'
    | 'BRANDES_KOEPF'
    | 'LINEAR_SEGMENTS'
    | 'SIMPLE';
  'elk.layered.nodePlacement.favorStraightEdges'?: 'true' | 'false';
  'elk.layered.crossingMinimization.strategy'?: 'LAYER_SWEEP' | 'INTERACTIVE' | 'NONE';
  'elk.layered.crossingMinimization.thoroughness'?: string;
  'elk.layered.crossingMinimization.forceNodeModelOrder'?: 'true' | 'false';
  'elk.layered.crossingMinimization.semiInteractive'?: 'true' | 'false';
  'elk.layered.cycleBreaking.strategy'?: 'DEPTH_FIRST' | 'GREEDY' | 'INTERACTIVE' | 'MODEL_ORDER';
  'elk.layered.highDegreeNodes.treatment'?: 'true' | 'false';
  'elk.layered.highDegreeNodes.threshold'?: string;
  'elk.layered.compaction.postCompaction.strategy'?: 'EDGE_LENGTH' | 'NONE' | 'CONSTRAINT_GRAPH';
  'elk.separateConnectedComponents'?: 'true' | 'false';
  'elk.layered.considerModelOrder.strategy'?: 'NODES_AND_EDGES' | 'NODES_ONLY' | 'NONE';
  'elk.layered.wrapping.strategy'?: 'SINGLE_EDGE' | 'MULTI_EDGE' | 'OFF';
  'elk.layered.unnecessaryBendpoints'?: 'true' | 'false';
  'elk.layered.mergeEdges'?: 'true' | 'false';
  'elk.layered.feedbackEdges'?: 'true' | 'false';
  'elk.spacing.edgeEdge'?: string;
  'elk.layered.edgeRouting.selfLoopDistribution'?:
    | 'EQUALLY_DISTRIBUTED'
    | 'NORTH_SOUTH_PORT'
    | 'PREFER_SAME_PORT';
  'elk.partitioning.activate'?: 'true' | 'false';
  'elk.partitioning.partition'?: string;
  'elk.aspectRatio'?: string;
  'elk.layered.layering.strategy'?:
    | 'NETWORK_SIMPLEX'
    | 'LONGEST_PATH'
    | 'COFFMAN_GRAHAM'
    | 'DF_MODEL_ORDER'
    | 'BF_MODEL_ORDER'
    | 'INTERACTIVE'
    | 'STRETCH_WIDTH'
    | 'MIN_WIDTH';
  'elk.randomSeed'?: string;
}

/**
 * Cast a {@link BpmnElkOptions} value to `LayoutOptions` for passing to
 * elkjs functions that expect `Record<string, string>`.
 */
export function asElkLayoutOptions(opts: BpmnElkOptions): LayoutOptions {
  return opts as LayoutOptions;
}

/** Optional parameters for ELK layout. */
export interface ElkLayoutOptions {
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  nodeSpacing?: number;
  layerSpacing?: number;
  /** Restrict layout to a specific subprocess or participant (scope). */
  scopeElementId?: string;
  /** Pin the main (happy) path to a single row for visual clarity. */
  preserveHappyPath?: boolean;
  /**
   * Grid snap: enable/disable post-ELK grid snap (default: true).
   * Preserved for API compatibility but no longer has effect (Phase 3 removed
   * the grid-snap subsystem — ELK's own alignment is trusted).
   */
  gridSnap?: boolean;
  /**
   * Grid quantum (px) for pixel-level snapping after layout.
   * When set, shapes are snapped to the nearest multiple of this value.
   */
  gridQuantum?: number;
  /**
   * Simplify gateway branch routes (default: true).
   * Preserved for API compatibility.
   */
  simplifyRoutes?: boolean;
  /**
   * Layout compactness preset.
   * - 'compact': tighter spacing (nodeSpacing=40, layerSpacing=50)
   * - 'spacious': generous spacing (nodeSpacing=80, layerSpacing=100)
   * Explicit nodeSpacing/layerSpacing values override compactness presets.
   */
  compactness?: 'compact' | 'spacious';
  /**
   * Lane layout strategy:
   * - 'preserve': keep lanes in their original top-to-bottom order (default)
   * - 'optimize': reorder lanes to minimise cross-lane sequence flows
   */
  laneStrategy?: 'preserve' | 'optimize';
}

/** Result of crossing flow detection: count + pairs of crossing flow IDs. */
export interface CrossingFlowsResult {
  count: number;
  pairs: Array<[string, string]>;
}

/**
 * Lane-crossing metrics: statistics about how many sequence flows
 * cross lane boundaries within participant pools.
 */
export interface LaneCrossingMetrics {
  /** Total number of sequence flows between lane-assigned elements. */
  totalLaneFlows: number;
  /** Number of those flows that cross lane boundaries. */
  crossingLaneFlows: number;
  /** IDs of the crossing flows (omitted if none). */
  crossingFlowIds?: string[];
  /** Percentage of flows staying within the same lane (0–100). Higher is better. */
  laneCoherenceScore: number;
}

/**
 * Shared context threaded through the layout pipeline steps.
 */
export interface LayoutContext {
  elementRegistry: ElementRegistry;
  modeling: Modeling;
  result: ElkNode;
  offsetX: number;
  offsetY: number;
  options: ElkLayoutOptions | undefined;
  boundaryLeafTargetIds: Set<string>;
  laneSnapshots: LaneSnapshot[];
  boundarySnapshots: BoundaryEventSnapshot[];
  /** Logger for the current pipeline invocation. */
  log: LayoutLogger;
  /** Output slot populated by the `detectCrossingFlows` pipeline step. */
  crossingFlowsResult?: CrossingFlowsResult;
}

/**
 * A single step in the ELK layout pipeline.
 */
export interface PipelineStep {
  /** Human-readable step name for logging and metrics. */
  name: string;
  /** Execute the step. May be async (e.g. for ELK's Promise-based API). */
  run: (ctx: LayoutContext) => void | Promise<void>;
  /** Return true to skip this step for the given context. */
  skip?: (ctx: LayoutContext) => boolean;
  /** When true, capture element positions before and after to produce a delta. */
  trackDelta?: boolean;
}
