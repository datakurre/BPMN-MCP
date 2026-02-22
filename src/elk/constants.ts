/**
 * ELK-specific constants for BPMN diagram layout.
 */

import type { BpmnElkOptions } from './types';
import {
  ELK_LAYER_SPACING,
  ELK_NODE_SPACING,
  ELK_EDGE_NODE_SPACING,
  ELK_EDGE_EDGE_BETWEEN_LAYERS_SPACING,
  ELK_EDGE_NODE_BETWEEN_LAYERS_SPACING,
} from '../constants';

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

/**
 * Offset from origin so the diagram has comfortable breathing room.
 */
export const ORIGIN_OFFSET_X = 180;
export const ORIGIN_OFFSET_Y = 80;
export const NORMALISE_ORIGIN_Y = 94;
export const NORMALISE_BOUNDARY_ORIGIN_Y = 105;

/**
 * Large displacement threshold (px) for normaliseOrigin().
 */
export const NORMALISE_LARGE_THRESHOLD = 40;

/**
 * Maximum X-centre delta (px) for two elements to be considered in the same
 * ELK layer during post-layout alignment passes.
 */
export const SAME_LAYER_X_THRESHOLD = 50;

/** Default vertical offset (px) below the flow for data objects/stores. */
export const ARTIFACT_BELOW_OFFSET = 80;
/** Default vertical offset (px) above the flow for text annotations. */
export const ARTIFACT_ABOVE_OFFSET = 80;

// ── ELK graph construction ──────────────────────────────────────────────

/**
 * Y-range threshold (px) to classify a container as having DI-imported
 * coordinates (diverse Y).
 */
export const DIVERSE_Y_THRESHOLD = 100;

/**
 * ELK priority for happy-path edges (straightness + direction) and
 * split-gateway shortness.
 */
export const ELK_HIGH_PRIORITY = '10';

// ── Pool layout constants ───────────────────────────────────────────────

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

// ── Element sizing constants ────────────────────────────────────────────

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

// ── Layout positioning constants ────────────────────────────────────────

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

// ── Artifact positioning constants ──────────────────────────────────────

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

// ── Boundary event positioning constants ────────────────────────────────

/** Y-distance buffer (px) for boundary event target row qualification. */
export const BOUNDARY_TARGET_ROW_BUFFER = 10;
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

// ── Lane layout constants ───────────────────────────────────────────────

/** Minimum lane height (px) inside a participant pool (horizontal lanes). */
export const MIN_LANE_HEIGHT = 250;
/** Minimum lane width (px) inside a participant pool (vertical columns). */
export const MIN_LANE_WIDTH = 200;
/** Left label band width (px) inside a participant pool. */
export const POOL_LABEL_BAND = 30;
/** Vertical padding (px) above/below content within each lane band. */
export const LANE_VERTICAL_PADDING = 30;
/** Horizontal padding (px) left/right of content within each lane column. */
export const LANE_HORIZONTAL_PADDING = 30;

// ── Subset layout routing constants ─────────────────────────────────────

/** Vertical margin (px) below the lowest element for loopback routing. */
export const LOOPBACK_BELOW_MARGIN = 30;
/** Vertical margin (px) above the topmost element for above-loopback routing. */
export const LOOPBACK_ABOVE_MARGIN = 30;
/** Horizontal margin (px) outside source/target for loopback vertical segments. */
export const LOOPBACK_HORIZONTAL_MARGIN = 15;

// ── Position application constants ──────────────────────────────────────

/** Significance threshold (px) for element resize and repositioning. */
export const RESIZE_SIGNIFICANCE_THRESHOLD = 5;
/** Default height (px) for collapsed participant pools when not specified. */
export const COLLAPSED_POOL_DEFAULT_HEIGHT = 60;

// ── Graph builder constants ─────────────────────────────────────────────

/** Maximum trace depth for synthetic ordering edges in gateway analysis. */
export const MAX_TRACE_DEPTH = 15;

// ── Subset layout constants ─────────────────────────────────────────────

/**
 * Y-centre proximity (px) for two endpoints to be considered "same row"
 * when rebuilding neighbor edges in subset (partial) layout.
 */
export const SUBSET_NEIGHBOR_SAME_ROW_THRESHOLD = 15;

// ── ELK algorithm tuning ───────────────────────────────────────────────

/**
 * ELK crossing minimisation thoroughness.
 * Higher values produce fewer edge crossings at the cost of layout time.
 */
export const ELK_CROSSING_THOROUGHNESS = '30';
