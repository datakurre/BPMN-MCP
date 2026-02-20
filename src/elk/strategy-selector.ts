/**
 * K2: Layout strategy selector.
 *
 * Analyses a BPMN diagram and recommends the optimal layout strategy,
 * enabling the layout engine to automatically choose the right pipeline
 * configuration for each diagram shape:
 *
 * | Strategy           | Diagram shape                              |
 * |--------------------|--------------------------------------------|
 * | `deterministic`    | Linear chains, single split-merge          |
 * | `elk-subset`       | Small edits (N ≤ `SUBSET_THRESHOLD` nodes) |
 * | `elk-lanes`        | Single pool with lanes                     |
 * | `elk-collaboration`| Multi-pool collaboration with message flows|
 * | `elk-full`         | All other diagrams (default)               |
 *
 * The selector does **not** run the layout — it only analyses and recommends.
 * Use the `strategy` and `confidence` fields to decide how to proceed.
 *
 * @see TODO K2 for background.
 */

import type { DiagramState } from '../types';
import type { BpmnElement, ElementRegistry } from '../bpmn-types';

// ── Strategy types ──────────────────────────────────────────────────────────

/**
 * Recommended layout strategy for a given diagram shape.
 *
 * - `deterministic` — no ELK; fast positional formula for trivial diagrams.
 * - `elk-subset`    — partial ELK layout for a small region of the diagram.
 * - `elk-lanes`     — full ELK with lane-aware post-processing.
 * - `elk-collaboration` — full ELK with multi-pool message-flow handling.
 * - `elk-full`      — full ELK Sugiyama layout (default).
 */
export type LayoutStrategy =
  | 'deterministic'
  | 'elk-subset'
  | 'elk-lanes'
  | 'elk-collaboration'
  | 'elk-full';

/** Confidence level for the recommendation. */
export type StrategyConfidence = 'high' | 'medium' | 'low';

/** Result of the strategy analysis. */
export interface StrategyAnalysis {
  /** Recommended strategy. */
  strategy: LayoutStrategy;
  /** Human-readable explanation of the recommendation. */
  reason: string;
  /** How confident the selector is in this recommendation. */
  confidence: StrategyConfidence;
  /** Diagram statistics used to derive the recommendation. */
  stats: DiagramStats;
}

/** Raw counts extracted from the element registry. */
export interface DiagramStats {
  /** Total flow nodes (tasks, events, gateways, subprocesses). */
  flowNodeCount: number;
  /** Number of sequence flows. */
  sequenceFlowCount: number;
  /** Number of message flows. */
  messageFlowCount: number;
  /** Number of participant pools. */
  participantCount: number;
  /** Number of lanes across all pools. */
  laneCount: number;
  /** Number of expanded subprocesses. */
  expandedSubprocessCount: number;
  /** Number of boundary events. */
  boundaryEventCount: number;
  /** Whether the diagram appears trivial (linear / single split-merge). */
  isTrivialShape: boolean;
}

// ── Thresholds ──────────────────────────────────────────────────────────────

/**
 * Maximum flow-node count for `deterministic` strategy.
 * Beyond this count, even trivial-looking diagrams may have enough complexity
 * (boundary events, nested subprocesses) to benefit from ELK.
 */
const DETERMINISTIC_MAX_NODES = 20;

// ── Analysis ────────────────────────────────────────────────────────────────

/** Classify a bpmn-js element type as a flow node. */
function isFlowNode(type: string): boolean {
  return (
    type.includes('Task') ||
    type.includes('Event') ||
    type.includes('Gateway') ||
    type === 'bpmn:SubProcess' ||
    type === 'bpmn:CallActivity'
  );
}

/** Collect diagram statistics from the element registry. */
function collectStats(elementRegistry: ElementRegistry): DiagramStats {
  const allElements: BpmnElement[] = elementRegistry.getAll();

  let flowNodeCount = 0;
  let sequenceFlowCount = 0;
  let messageFlowCount = 0;
  let participantCount = 0;
  let laneCount = 0;
  let expandedSubprocessCount = 0;
  let boundaryEventCount = 0;

  for (const el of allElements) {
    if (isFlowNode(el.type)) {
      if (el.type === 'bpmn:BoundaryEvent') {
        boundaryEventCount++;
      } else if (el.type === 'bpmn:SubProcess' && !el.collapsed) {
        expandedSubprocessCount++;
        flowNodeCount++;
      } else {
        flowNodeCount++;
      }
    } else if (el.type === 'bpmn:SequenceFlow') {
      sequenceFlowCount++;
    } else if (el.type === 'bpmn:MessageFlow') {
      messageFlowCount++;
    } else if (el.type === 'bpmn:Participant') {
      participantCount++;
    } else if (el.type === 'bpmn:Lane') {
      laneCount++;
    }
  }

  // Trivial shape: linear chain or single split-merge (no complex branching).
  // Heuristic: average of ≤1.2 outgoing flows per gateway means mostly linear.
  const gatewayCount = allElements.filter((el) => el.type.includes('Gateway')).length;
  const branchFlows = allElements.filter(
    (el) =>
      el.type === 'bpmn:SequenceFlow' && el.source?.type.includes('Gateway') && el.outgoing == null
  ).length;
  const avgBranching = gatewayCount === 0 ? 1 : branchFlows / gatewayCount;
  const isTrivialShape =
    flowNodeCount <= DETERMINISTIC_MAX_NODES &&
    expandedSubprocessCount === 0 &&
    boundaryEventCount === 0 &&
    messageFlowCount === 0 &&
    laneCount === 0 &&
    (gatewayCount === 0 || avgBranching <= 2.5);

  return {
    flowNodeCount,
    sequenceFlowCount,
    messageFlowCount,
    participantCount,
    laneCount,
    expandedSubprocessCount,
    boundaryEventCount,
    isTrivialShape,
  };
}

// ── Decision logic ──────────────────────────────────────────────────────────

/**
 * Analyse a BPMN diagram and recommend the optimal layout strategy.
 *
 * The analysis examines element counts, pool/lane structure, message flows,
 * and subprocesses to produce a recommendation with a confidence level.
 *
 * @example
 * ```ts
 * const analysis = selectLayoutStrategy(diagram);
 * console.log(analysis.strategy, analysis.reason);
 * // → 'elk-lanes' 'Diagram has 3 lanes; use ELK with lane-aware post-processing'
 * ```
 */
export function selectLayoutStrategy(diagram: DiagramState): StrategyAnalysis {
  const elementRegistry = diagram.modeler.get('elementRegistry') as ElementRegistry;
  const stats = collectStats(elementRegistry);

  // ── 1. Trivial diagrams → deterministic ────────────────────────────────
  if (stats.isTrivialShape && stats.flowNodeCount > 0) {
    return {
      strategy: 'deterministic',
      reason:
        `Diagram has ${stats.flowNodeCount} flow nodes with no lanes, boundary events, ` +
        `subprocesses or message flows — deterministic layout is sufficient and faster than ELK.`,
      confidence: 'high',
      stats,
    };
  }

  // ── 2. Multi-pool collaboration → elk-collaboration ─────────────────────
  if (stats.participantCount >= 2 || stats.messageFlowCount > 0) {
    const confidence: StrategyConfidence =
      stats.participantCount >= 2 && stats.messageFlowCount > 0 ? 'high' : 'medium';
    return {
      strategy: 'elk-collaboration',
      reason:
        `Diagram has ${stats.participantCount} participant pool(s) and ` +
        `${stats.messageFlowCount} message flow(s) — use ELK with multi-pool ` +
        `message-flow routing.`,
      confidence,
      stats,
    };
  }

  // ── 3. Single pool with lanes → elk-lanes ───────────────────────────────
  if (stats.laneCount >= 2) {
    return {
      strategy: 'elk-lanes',
      reason:
        `Diagram has ${stats.laneCount} swim lanes — use ELK with lane-aware ` +
        `post-processing to respect lane boundaries during layout.`,
      confidence: 'high',
      stats,
    };
  }

  // ── 4. Default → elk-full ───────────────────────────────────────────────
  const reasons: string[] = [];
  if (stats.expandedSubprocessCount > 0) {
    reasons.push(`${stats.expandedSubprocessCount} expanded subprocess(es)`);
  }
  if (stats.boundaryEventCount > 0) {
    reasons.push(`${stats.boundaryEventCount} boundary event(s)`);
  }
  if (stats.flowNodeCount > DETERMINISTIC_MAX_NODES) {
    reasons.push(`${stats.flowNodeCount} flow nodes (above deterministic threshold)`);
  }

  const reasonStr =
    reasons.length > 0
      ? `Diagram has ${reasons.join(', ')} — use full ELK Sugiyama layout.`
      : `Use full ELK Sugiyama layout (default).`;

  return {
    strategy: 'elk-full',
    reason: reasonStr,
    confidence: reasons.length > 0 ? 'high' : 'medium',
    stats,
  };
}
