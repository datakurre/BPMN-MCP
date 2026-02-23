/**
 * Centralised magic numbers, element-size constants, and ELK layout
 * configuration.
 *
 * Keeps layout-related values in one place so changes propagate
 * consistently across all handlers that do positioning / spacing.
 */

import type { BpmnElkOptions } from './elk/types';

/** Standard edge-to-edge gap in pixels between BPMN elements. */
export const STANDARD_BPMN_GAP = 50;

/**
 * ELK-specific spacing constants.
 *
 * Tuned to match bpmn-js's built-in auto-place spacing (~58px average
 * edge-to-edge gaps, ~110px vertical branch separation).  Kept separate
 * from STANDARD_BPMN_GAP which is used for auto-positioning in
 * add-element.ts and connection routing fallbacks.
 */
export const ELK_LAYER_SPACING = 60;
export const ELK_NODE_SPACING = 50;
export const ELK_EDGE_NODE_SPACING = 15;

/**
 * Spacing (px) between parallel edges running between layers.
 *
 * ELK default is 10, but BPMN diagrams benefit from slightly more
 * breathing room to avoid overlapping labels and crowded branch routes.
 */
export const ELK_EDGE_EDGE_BETWEEN_LAYERS_SPACING = 15;

/**
 * Spacing (px) between edges and nodes in adjacent layers.
 *
 * Prevents edge routes from hugging too close to unrelated nodes.
 * ELK default is 10; a modest increase reduces visual clutter.
 */
export const ELK_EDGE_NODE_BETWEEN_LAYERS_SPACING = 15;

/**
 * Tighter edge-to-edge gap (px) between elements that are all branches
 * of the same gateway (parallel fork-join pattern).
 *
 * Reference layouts use 110px centre-to-centre for 80px-tall tasks,
 * i.e. 30px edge-to-edge.  The general ELK_NODE_SPACING (50px) is too
 * wide for this pattern.  Only applied when every element in a layer
 * shares the same source or target gateway.
 */
export const ELK_BRANCH_NODE_SPACING = 30;

/**
 * Edge-to-edge gap (px) between a happy-path element and a boundary
 * sub-flow target in the same layer.
 *
 * Reference layouts place boundary exception paths ~40px edge-to-edge
 * below the main flow (120px centre-to-centre for 80px-tall tasks).
 * Tighter than general ELK_NODE_SPACING but looser than gateway branches.
 */
export const ELK_BOUNDARY_NODE_SPACING = 40;

export const ELK_COMPACT_NODE_SPACING = 40;
export const ELK_SPACIOUS_NODE_SPACING = 80;
export const ELK_COMPACT_LAYER_SPACING = 50;
export const ELK_SPACIOUS_LAYER_SPACING = 100;

/**
 * Default element sizes used for layout calculations.
 *
 * These mirror the bpmn-js defaults for each element category.
 */
export const ELEMENT_SIZES: Readonly<Record<string, { width: number; height: number }>> = {
  task: { width: 100, height: 80 },
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 },
  subprocess: { width: 350, height: 200 },
  participant: { width: 600, height: 250 },
  textAnnotation: { width: 100, height: 30 },
  dataObject: { width: 36, height: 50 },
  dataStore: { width: 50, height: 50 },
  group: { width: 300, height: 200 },
  default: { width: 100, height: 80 },
};

/** Look up the default size for a given BPMN element type string. */
// ── Label positioning constants ────────────────────────────────────────────

/** Distance between element edge and external label. */
export const ELEMENT_LABEL_DISTANCE = 10;

/** Default external label dimensions (matches bpmn-js). */
export const DEFAULT_LABEL_SIZE = { width: 90, height: 20 };

// ── Pool/lane sizing utilities ─────────────────────────────────────────────

/** Minimum pool width in pixels. */
export const MIN_POOL_WIDTH = 350;

/** Pixels per element for pool width estimation. */
export const WIDTH_PER_ELEMENT = 150;

/** Minimum lane height in pixels (for auto-sizing). */
export const MIN_LANE_HEIGHT = 120;

/** Default pool height per lane row (when creating lanes). */
export const HEIGHT_PER_LANE = 150;

/** Minimum pool height in pixels. */
export const MIN_POOL_HEIGHT = 250;

/**
 * Minimum padding (px) inside expanded subprocesses around their child elements.
 *
 * When auto-sizing subprocesses, the subprocess bounds should be at least
 * `innerElementExtent + SUBPROCESS_INNER_PADDING` on each side.
 */
export const SUBPROCESS_INNER_PADDING = 30;

/**
 * Pool aspect ratio range for readability.
 *
 * Pools with a width:height ratio below MIN_POOL_ASPECT_RATIO look too tall/narrow,
 * and above MAX_POOL_ASPECT_RATIO look too wide/short. The autosize tool can
 * optionally enforce these bounds.
 */
export const MIN_POOL_ASPECT_RATIO = 3;
export const MAX_POOL_ASPECT_RATIO = 5;

/**
 * Calculate optimal pool dimensions based on element count and lane count.
 *
 * Width formula:  `max(1200, elementCount × 150)`
 * Height formula: `max(250, laneCount × 150)`
 *
 * When no elements exist yet (e.g. at creation time), uses the lane count to
 * estimate a reasonable default width (each lane will hold ~4 elements on
 * average, so width ≈ laneCount × 4 × 150 / laneCount = 600 minimum).
 *
 * @param elementCount  Number of flow elements (tasks, events, gateways)
 * @param laneCount     Number of lanes (0 if no lanes)
 * @param nestingDepth  Maximum subprocess nesting depth (0 if flat)
 */
export function calculateOptimalPoolSize(
  elementCount: number = 0,
  laneCount: number = 0,
  nestingDepth: number = 0
): { width: number; height: number } {
  // Width: at least 1200, scale with element count
  const nestingMultiplier = 1 + nestingDepth * 0.3;
  const baseWidth = Math.max(1200, elementCount * WIDTH_PER_ELEMENT);
  const width = Math.ceil((baseWidth * nestingMultiplier) / 10) * 10;

  // Height: scale with lane count, minimum 250
  const laneHeight = laneCount > 0 ? laneCount * HEIGHT_PER_LANE : MIN_POOL_HEIGHT;
  const height = Math.max(MIN_POOL_HEIGHT, Math.ceil(laneHeight / 10) * 10);

  return { width, height };
}

// ── Element size helpers ───────────────────────────────────────────────────

export function getElementSize(elementType: string): { width: number; height: number } {
  if (elementType.includes('Gateway')) return ELEMENT_SIZES.gateway;
  if (elementType.includes('Event')) return ELEMENT_SIZES.event;
  if (elementType === 'bpmn:SubProcess') return ELEMENT_SIZES.subprocess;
  if (elementType === 'bpmn:Participant') return ELEMENT_SIZES.participant;
  if (elementType === 'bpmn:Lane') return { width: 600, height: 150 };
  if (elementType === 'bpmn:TextAnnotation') return ELEMENT_SIZES.textAnnotation;
  if (elementType === 'bpmn:DataObjectReference') return ELEMENT_SIZES.dataObject;
  if (elementType === 'bpmn:DataStoreReference') return ELEMENT_SIZES.dataStore;
  if (elementType === 'bpmn:Group') return ELEMENT_SIZES.group;
  if (elementType.includes('Task') || elementType === 'bpmn:CallActivity') {
    return ELEMENT_SIZES.task;
  }
  return ELEMENT_SIZES.default;
}

// ── ELK layout configuration ───────────────────────────────────────────────

/** Default ELK layout options tuned for BPMN diagrams. */
export const ELK_LAYOUT_OPTIONS: BpmnElkOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': String(ELK_NODE_SPACING),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(ELK_LAYER_SPACING),
  'elk.spacing.edgeNode': String(ELK_EDGE_NODE_SPACING),
  'elk.layered.spacing.edgeEdgeBetweenLayers': String(ELK_EDGE_EDGE_BETWEEN_LAYERS_SPACING),
  'elk.layered.spacing.edgeNodeBetweenLayers': String(ELK_EDGE_NODE_BETWEEN_LAYERS_SPACING),
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.favorStraightEdges': 'true',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.layered.highDegreeNodes.treatment': 'true',
  'elk.layered.highDegreeNodes.threshold': '5',
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '50',
  'elk.randomSeed': '1',
};

/**
 * ELK crossing minimisation thoroughness.
 * Higher values produce fewer edge crossings at the cost of layout time.
 */
export const ELK_CROSSING_THOROUGHNESS = '30';

/**
 * ELK priority for happy-path edges (straightness + direction) and
 * split-gateway shortness.
 */
export const ELK_HIGH_PRIORITY = '10';

// ── ELK container padding ──────────────────────────────────────────────────

/** Padding inside compound containers (expanded subprocesses). */
export const CONTAINER_PADDING = '[top=60,left=40,bottom=60,right=50]';

/** Padding inside event subprocesses (reduced to fit compact interrupt/non-interrupt handlers). */
export const EVENT_SUBPROCESS_PADDING = '[top=40,left=32,bottom=40,right=32]';

/** Padding inside participant pools — extra left for the ~30px bpmn-js label band. */
export const PARTICIPANT_PADDING = '[top=80,left=50,bottom=80,right=40]';

/**
 * Padding inside participant pools that contain lanes.
 * Lanes have their own ~30px label band on the left, so elements need
 * to be pushed further right: pool label band (30) + lane label band (30)
 * + breathing room (20) = 80px total left padding.
 */
export const PARTICIPANT_WITH_LANES_PADDING = '[top=80,left=80,bottom=80,right=40]';

// ── ELK origin and normalisation ───────────────────────────────────────────

/** Offset from origin so the diagram has comfortable breathing room. */
export const ORIGIN_OFFSET_X = 180;
export const ORIGIN_OFFSET_Y = 80;
export const NORMALISE_ORIGIN_Y = 94;
export const NORMALISE_BOUNDARY_ORIGIN_Y = 105;

/** Large displacement threshold (px) for normaliseOrigin(). */
export const NORMALISE_LARGE_THRESHOLD = 40;

// ── ELK element sizing ────────────────────────────────────────────────────

/** Standard BPMN task width (px). */
export const BPMN_TASK_WIDTH = 100;
/** Standard BPMN task height (px). */
export const BPMN_TASK_HEIGHT = 80;
/** Standard BPMN dummy/placeholder node height (px) for ELK graph. */
export const BPMN_DUMMY_HEIGHT = 30;
/** Standard BPMN event diameter (px). */
export const BPMN_EVENT_SIZE = 36;
/** Default width (px) for compound containers (pools, subprocesses) when not specified. */
export const CONTAINER_DEFAULT_WIDTH = 300;
/** Default height (px) for compound containers (pools, subprocesses) when not specified. */
export const CONTAINER_DEFAULT_HEIGHT = 200;

// ── ELK positioning ───────────────────────────────────────────────────────

/** Factor for calculating element center X/Y (0.5 = middle). */
export const CENTER_FACTOR = 0.5;
/** Start position X-offset (px) from ELK origin. */
export const START_OFFSET_X = 20;
/** Start position Y-offset (px) from ELK origin. */
export const START_OFFSET_Y = 50;
/** Gateway vertical split factor for branch positioning. */
export const GATEWAY_UPPER_SPLIT_FACTOR = 0.67;
/** Minimum movement threshold (px) to trigger element repositioning. */
export const MOVEMENT_THRESHOLD = 0.5;

// ── ELK graph construction ────────────────────────────────────────────────

/**
 * Y-range threshold (px) to classify a container as having DI-imported
 * coordinates (diverse Y).
 */
export const DIVERSE_Y_THRESHOLD = 100;

/** Maximum trace depth for synthetic ordering edges in gateway analysis. */
export const MAX_TRACE_DEPTH = 15;

// ── ELK pool layout ──────────────────────────────────────────────────────

/**
 * Gap (px) between the bottom of the last expanded pool and the first
 * collapsed pool.
 */
export const COLLAPSED_POOL_GAP = 50;

/**
 * Extra vertical spacing (px) added between participant pools in
 * collaboration diagrams.
 */
export const INTER_POOL_GAP_EXTRA = 68;

/** Significance threshold (px) for element resize and repositioning. */
export const RESIZE_SIGNIFICANCE_THRESHOLD = 5;
/** Default height (px) for collapsed participant pools when not specified. */
export const COLLAPSED_POOL_DEFAULT_HEIGHT = 60;

// ── ELK artifact positioning ──────────────────────────────────────────────

/** Default vertical offset (px) below the flow for data objects/stores. */
export const ARTIFACT_BELOW_OFFSET = 80;
/** Default vertical offset (px) above the flow for text annotations. */
export const ARTIFACT_ABOVE_OFFSET = 80;
/** Minimum Y-distance (px) below flow elements for data objects/stores. */
export const ARTIFACT_BELOW_MIN = 80;
/** Minimum Y-distance (px) above flow elements for text annotations. */
export const ARTIFACT_ABOVE_MIN = 150;
/** Padding (px) around artifacts when checking for overlaps. */
export const ARTIFACT_PADDING = 20;
/** Negative padding for left-side artifact placement. */
export const ARTIFACT_NEGATIVE_PADDING = -20;
/** Vertical search height (px) when finding space for artifacts. */
export const ARTIFACT_SEARCH_HEIGHT = 200;

// ── ELK boundary event positioning ────────────────────────────────────────

/**
 * Fraction of host width/height used as margin on each side when
 * spreading multiple boundary events along the same border.
 */
export const BOUNDARY_SPREAD_MARGIN_FACTOR = 0.1;
/** Distance (px) from boundary event's host bottom edge to target centre Y. */
export const BOUNDARY_TARGET_Y_OFFSET = 85;
/** Distance (px) from boundary event centre X to its leaf target centre X. */
export const BOUNDARY_TARGET_X_OFFSET = 90;
/** Proximity tolerance (px) for boundary event repositioning. */
export const BOUNDARY_PROXIMITY_TOLERANCE = 60;

// ── ELK lane layout ─────────────────────────────────────────────────────

/** Minimum lane height (px) for ELK lane repositioning within pools. */
export const ELK_MIN_LANE_HEIGHT = 250;
/** Minimum lane width (px) inside a participant pool (vertical columns). */
export const ELK_MIN_LANE_WIDTH = 200;
/** Left label band width (px) inside a participant pool. */
export const POOL_LABEL_BAND = 30;
/** Vertical padding (px) above/below content within each lane band. */
export const LANE_VERTICAL_PADDING = 30;
/** Horizontal padding (px) left/right of content within each lane column. */
export const LANE_HORIZONTAL_PADDING = 30;

// ── ELK subset layout routing ─────────────────────────────────────────────

/** Vertical margin (px) below the lowest element for loopback routing. */
export const LOOPBACK_BELOW_MARGIN = 30;
/** Vertical margin (px) above the topmost element for above-loopback routing. */
export const LOOPBACK_ABOVE_MARGIN = 30;
/** Horizontal margin (px) outside source/target for loopback vertical segments. */
export const LOOPBACK_HORIZONTAL_MARGIN = 15;

/**
 * Y-centre proximity (px) for two endpoints to be considered "same row"
 * when rebuilding neighbor edges in subset (partial) layout.
 */
export const SUBSET_NEIGHBOR_SAME_ROW_THRESHOLD = 15;
