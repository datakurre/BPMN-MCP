/**
 * ELK-based layout engine for BPMN diagrams.
 *
 * Uses elkjs (Eclipse Layout Kernel) with the Sugiyama layered algorithm
 * to produce clean left-to-right layouts.  Handles flat processes,
 * collaborations with participants, and expanded subprocesses as compound
 * nodes.
 *
 * Boundary events are excluded from the ELK graph — they follow their
 * host element automatically when bpmn-js moves the host.
 *
 * Post-layout pipeline (simplified — Phase 3):
 * 1. Apply ELK node positions + resize compound nodes
 * 2. Finalise pools and lanes
 * 3. Fix boundary events (single restore cycle, after pools/lanes)
 * 4. Position event subprocesses
 * 5. Reposition artifacts (text annotations, data objects)
 * 6. Layout all connections via modeling.layoutConnection() (ManhattanLayout)
 * 7. Normalise origin
 * 8. Detect crossing flows (optional diagnostic)
 */

import type { DiagramState } from '../types';
import type { LayoutOptions } from 'elkjs';

import type { BpmnElement, ElementRegistry, Canvas } from '../bpmn-types';
import {
  ELK_LAYOUT_OPTIONS,
  ORIGIN_OFFSET_X,
  ORIGIN_OFFSET_Y,
  ELK_CROSSING_THOROUGHNESS,
} from './constants';
import {
  ELK_COMPACT_NODE_SPACING,
  ELK_COMPACT_LAYER_SPACING,
  ELK_SPACIOUS_NODE_SPACING,
  ELK_SPACIOUS_LAYER_SPACING,
} from '../constants.js';
import { buildContainerGraph } from './graph-builder';
import {
  applyElkPositions,
  resizeCompoundNodes,
  positionEventSubprocesses,
  centreElementsInPools,
  enforceExpandedPoolGap,
  reorderCollapsedPoolsBelow,
  normaliseOrigin,
  repositionAdHocSubprocessChildren,
} from './position-application';
import { repositionLanes, saveLaneNodeAssignments } from './lane-layout';
import { saveBoundaryEventData, restoreBoundaryEventData } from './boundary-save-restore';
import { repositionBoundaryEvents } from './boundary-positioning';
import {
  identifyBoundaryExceptionChains,
  repositionBoundaryEventTargets,
  alignOffPathEndEventsToSecondRow,
  pushBoundaryTargetsBelowHappyPath,
  repositionCompensationHandlers,
} from './boundary-chains';
import { repositionArtifacts } from './artifacts';
import { detectCrossingFlows } from './crossing-detection';
import { isConnection } from './helpers';
import type { ElkLayoutOptions, LayoutContext, PipelineStep } from './types';
import { createLayoutLogger, type PositionSnapshot } from './layout-logger';
import { PipelineRunner } from './pipeline-runner';

export type {
  ElkLayoutOptions,
  CrossingFlowsResult,
  BpmnElkOptions,
  LayoutContext,
  PipelineStep,
} from './types';

export { PipelineRunner } from './pipeline-runner';
export { elkLayoutSubset } from './subset-layout';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Snapshot the { x, y } position of every layout-able shape in the
 * element registry.  Used by `stepWithDelta()` to compute how many elements
 * a pipeline step moved.
 */
function snapshotPositions(registry: ElementRegistry): PositionSnapshot {
  const snap: PositionSnapshot = new Map();
  for (const el of registry.getAll()) {
    // Only shapes have width/height; connections and root element do not.
    if (el.width !== undefined) {
      snap.set(el.id, { x: el.x ?? 0, y: el.y ?? 0 });
    }
  }
  return snap;
}

/**
 * Count how many elements moved by more than 1 px in either axis
 * since the given snapshot was taken.
 */
function countMovedElements(registry: ElementRegistry, before: PositionSnapshot): number {
  let moved = 0;
  for (const [id, pos] of before) {
    const el = registry.get(id);
    if (
      el !== undefined &&
      (Math.abs((el.x ?? 0) - pos.x) > 1 || Math.abs((el.y ?? 0) - pos.y) > 1)
    ) {
      moved++;
    }
  }
  return moved;
}

/**
 * Build ELK LayoutOptions from user-supplied ElkLayoutOptions,
 * merging direction, compactness presets, and explicit spacing overrides.
 */
function resolveLayoutOptions(options?: ElkLayoutOptions): {
  layoutOptions: LayoutOptions;
} {
  const layoutOptions: LayoutOptions = { ...ELK_LAYOUT_OPTIONS };

  if (options?.direction) {
    layoutOptions['elk.direction'] = options.direction;
  }

  // Apply compactness presets (overridden by explicit nodeSpacing/layerSpacing)
  if (options?.compactness === 'compact') {
    layoutOptions['elk.spacing.nodeNode'] = String(ELK_COMPACT_NODE_SPACING);
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(ELK_COMPACT_LAYER_SPACING);
  } else if (options?.compactness === 'spacious') {
    layoutOptions['elk.spacing.nodeNode'] = String(ELK_SPACIOUS_NODE_SPACING);
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(ELK_SPACIOUS_LAYER_SPACING);
  }

  // Explicit spacing values override compactness presets
  if (options?.nodeSpacing !== undefined) {
    layoutOptions['elk.spacing.nodeNode'] = String(options.nodeSpacing);
  }
  if (options?.layerSpacing !== undefined) {
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(options.layerSpacing);
  }

  layoutOptions['elk.layered.crossingMinimization.thoroughness'] = ELK_CROSSING_THOROUGHNESS;

  return { layoutOptions };
}

// ── Pipeline step functions ─────────────────────────────────────────────────

/** Apply ELK-computed node positions and resize compound nodes. */
async function applyNodePositions(ctx: LayoutContext): Promise<void> {
  applyElkPositions(ctx.elementRegistry, ctx.modeling, ctx.result, ctx.offsetX, ctx.offsetY);
  resizeCompoundNodes(ctx.elementRegistry, ctx.modeling, ctx.result);
  repositionAdHocSubprocessChildren(ctx.elementRegistry, ctx.modeling);
}

/**
 * Centre elements in pools, reposition lanes, and reorder collapsed
 * pools below expanded pools.
 */
function finalisePoolsAndLanes(ctx: LayoutContext): void {
  centreElementsInPools(ctx.elementRegistry, ctx.modeling);
  enforceExpandedPoolGap(ctx.elementRegistry, ctx.modeling);
  repositionLanes(
    ctx.elementRegistry,
    ctx.modeling,
    ctx.laneSnapshots,
    ctx.options?.laneStrategy,
    ctx.options?.direction
  );
  reorderCollapsedPoolsBelow(ctx.elementRegistry, ctx.modeling);
}

/**
 * Single boundary event restore cycle — runs AFTER finalisePoolsAndLanes
 * so that all host element moves are complete before snapping BEs to borders.
 *
 * Previously two restore cycles were needed because intermediate steps
 * (snapAndAlignLayers, gridSnap, happyPath, resolveOverlaps, pools/lanes)
 * moved host elements between cycles.  With the simplified pipeline, only
 * finalisePoolsAndLanes moves hosts after ELK positions are applied, so a
 * single restore after pools/lanes suffices.
 */
function fixBoundaryEvents(ctx: LayoutContext): void {
  restoreBoundaryEventData(ctx.elementRegistry, ctx.boundarySnapshots);
  repositionBoundaryEvents(ctx.elementRegistry, ctx.modeling, ctx.boundarySnapshots);

  repositionBoundaryEventTargets(ctx.elementRegistry, ctx.modeling, ctx.boundaryLeafTargetIds);

  pushBoundaryTargetsBelowHappyPath(
    ctx.elementRegistry,
    ctx.modeling,
    ctx.boundaryLeafTargetIds,
    undefined
  );

  alignOffPathEndEventsToSecondRow(
    ctx.elementRegistry,
    ctx.modeling,
    ctx.boundaryLeafTargetIds,
    undefined
  );

  repositionCompensationHandlers(ctx.elementRegistry, ctx.modeling);
}

/**
 * Layout all connections using bpmn-js's built-in ManhattanLayout.
 *
 * After ELK positions all elements, `modeling.layoutConnection()` computes
 * proper orthogonal routes for every connection based on the final element
 * positions.  This produces routes consistent with Camunda Modeler's
 * interactive editing, using `CroppingConnectionDocking` for accurate
 * endpoint placement on shape boundaries.
 */
function layoutAllConnections(ctx: LayoutContext): void {
  const allConnections = ctx.elementRegistry.filter(
    (el) => isConnection(el.type) && !!el.source && !!el.target
  );

  for (const conn of allConnections) {
    ctx.modeling.layoutConnection(conn);
  }
}

// ── Pipeline step arrays ────────────────────────────────────────────────────

/**
 * Node-positioning steps: apply ELK positions, finalise pools/lanes,
 * fix boundary events, and reposition artifacts.
 */
const NODE_POSITION_STEPS: PipelineStep[] = [
  {
    name: 'applyNodePositions',
    run: (ctx) => applyNodePositions(ctx),
    trackDelta: true,
  },
  {
    name: 'finalisePoolsAndLanes',
    run: (ctx) => finalisePoolsAndLanes(ctx),
  },
  {
    name: 'fixBoundaryEvents',
    run: (ctx) => fixBoundaryEvents(ctx),
    trackDelta: true,
  },
  {
    name: 'positionEventSubprocesses',
    run: (ctx) => positionEventSubprocesses(ctx.elementRegistry, ctx.modeling),
  },
  {
    name: 'repositionArtifacts',
    run: (ctx) => repositionArtifacts(ctx.elementRegistry, ctx.modeling),
  },
];

/**
 * Connection routing and finalisation steps.
 */
const ROUTING_STEPS: PipelineStep[] = [
  {
    name: 'layoutAllConnections',
    run: (ctx) => layoutAllConnections(ctx),
  },
  {
    name: 'normaliseOrigin',
    run: (ctx) => normaliseOrigin(ctx.elementRegistry, ctx.modeling),
  },
];

/**
 * Post-routing diagnostic steps.
 */
const POST_ROUTING_STEPS: PipelineStep[] = [
  {
    name: 'detectCrossingFlows',
    run: (ctx) => {
      ctx.crossingFlowsResult = detectCrossingFlows(ctx.elementRegistry);
    },
  },
];

/** All main-pipeline steps in execution order. */
export const MAIN_PIPELINE_STEPS: readonly PipelineStep[] = [
  ...NODE_POSITION_STEPS,
  ...ROUTING_STEPS,
  ...POST_ROUTING_STEPS,
];

// ── Main layout ─────────────────────────────────────────────────────────────

/**
 * Run ELK layered layout on a BPMN diagram.
 *
 * Uses the Sugiyama layered algorithm (via elkjs) to produce clean
 * left-to-right layouts with proper handling of parallel branches,
 * reconverging gateways, and nested containers.
 *
 * ## Pipeline (8 steps):
 * 1. applyNodePositions — apply ELK x/y, resize compound nodes
 * 2. finalisePoolsAndLanes — centre in pools, reposition lanes
 * 3. fixBoundaryEvents — single restore cycle (after pools/lanes)
 * 4. positionEventSubprocesses
 * 5. repositionArtifacts — text annotations, data objects
 * 6. layoutAllConnections — modeling.layoutConnection for each connection
 * 7. normaliseOrigin — ensure positive coordinates
 * 8. detectCrossingFlows — optional diagnostic
 */
export async function elkLayout(
  diagram: DiagramState,
  options?: ElkLayoutOptions
): Promise<{ crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> }> {
  // Dynamic import — elkjs is externalized in esbuild
  const ELK = (await import('elkjs')).default;
  const elk = new ELK();

  const log = createLayoutLogger('elkLayout');

  const elementRegistry = diagram.modeler.get('elementRegistry') as ElementRegistry;
  const modeling = diagram.modeler.get('modeling');
  const canvas = diagram.modeler.get('canvas');

  // Determine the layout root: scoped to a specific element, or the whole diagram
  const rootElement = resolveRootElement(elementRegistry, canvas, options);

  const allElements: BpmnElement[] = elementRegistry.getAll();
  log.note('init', `${allElements.length} elements, scope=${options?.scopeElementId ?? 'root'}`);

  // Identify boundary exception chains — excluded from ELK graph to prevent
  // proxy edges from creating extra layers that distort horizontal spacing
  // and cause boundary flows to cross through unrelated elements.
  const boundaryLeafTargetIds = identifyBoundaryExceptionChains(allElements, rootElement);

  const { children, edges, hasDiverseY } = buildContainerGraph(
    allElements,
    rootElement,
    boundaryLeafTargetIds
  );

  if (children.length === 0) return {};

  const { layoutOptions } = resolveLayoutOptions(options);

  // Check if we have event subprocesses that will be excluded and repositioned
  const hasEventSubprocesses = allElements.some(
    (el) =>
      el.parent === rootElement &&
      el.type === 'bpmn:SubProcess' &&
      el.businessObject?.triggeredByEvent === true
  );

  if (hasDiverseY && !hasEventSubprocesses) {
    layoutOptions['elk.layered.crossingMinimization.forceNodeModelOrder'] = 'true';
    layoutOptions['elk.layered.considerModelOrder.strategy'] = 'NODES_AND_EDGES';
    log.note('init', 'hasDiverseY=true — forceNodeModelOrder + NODES_AND_EDGES enabled');
  }

  log.note('init', `ELK graph: ${children.length} nodes, ${edges.length} edges`);

  log.beginStep('elk.layout');
  const result = await elk.layout({
    id: 'root',
    layoutOptions,
    children,
    edges,
  });
  log.endStep();

  const { offsetX, offsetY } = computeLayoutOffset(elementRegistry, options);

  // Build pipeline context
  const snap = () => snapshotPositions(elementRegistry);
  const countMoved = (before: PositionSnapshot) => countMovedElements(elementRegistry, before);

  const ctx: LayoutContext = {
    elementRegistry,
    modeling,
    result,
    offsetX,
    offsetY,
    options,
    boundaryLeafTargetIds,
    laneSnapshots: saveLaneNodeAssignments(elementRegistry),
    boundarySnapshots: saveBoundaryEventData(elementRegistry),
    log,
  };

  // Execute layout pipeline via PipelineRunner.
  const runner = new PipelineRunner(
    [...NODE_POSITION_STEPS, ...ROUTING_STEPS, ...POST_ROUTING_STEPS],
    log,
    { snap, count: countMoved }
  );
  await runner.run(ctx);

  const crossingFlowsResult = ctx.crossingFlowsResult ?? { count: 0, pairs: [] };
  log.note('result', `crossingFlows=${crossingFlowsResult.count}`);
  log.finish();
  return {
    crossingFlows: crossingFlowsResult.count,
    crossingFlowPairs: crossingFlowsResult.pairs,
  };
}

/**
 * Resolve the layout root element: scoped to a specific element, or the
 * whole diagram canvas root.
 */
function resolveRootElement(
  elementRegistry: ElementRegistry,
  canvas: Canvas,
  options?: ElkLayoutOptions
): BpmnElement {
  if (options?.scopeElementId) {
    const scopeEl = elementRegistry.get(options.scopeElementId);
    if (!scopeEl) {
      throw new Error(`Scope element not found: ${options.scopeElementId}`);
    }
    if (scopeEl.type !== 'bpmn:Participant' && scopeEl.type !== 'bpmn:SubProcess') {
      throw new Error(`Scope element must be a Participant or SubProcess, got: ${scopeEl.type}`);
    }
    return scopeEl;
  }
  return canvas.getRootElement();
}

/**
 * Compute the position offset for applying ELK results back to the diagram.
 * For scoped layout, uses the scope element's position; otherwise uses
 * the global origin offset.
 */
function computeLayoutOffset(
  elementRegistry: ElementRegistry,
  options?: ElkLayoutOptions
): { offsetX: number; offsetY: number } {
  if (options?.scopeElementId) {
    const scopeEl = elementRegistry.get(options.scopeElementId);
    return { offsetX: scopeEl?.x ?? ORIGIN_OFFSET_X, offsetY: scopeEl?.y ?? ORIGIN_OFFSET_Y };
  }
  return { offsetX: ORIGIN_OFFSET_X, offsetY: ORIGIN_OFFSET_Y };
}
