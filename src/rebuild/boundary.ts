/**
 * Boundary event and exception chain identification for the rebuild-based
 * layout engine.
 *
 * Identifies boundary events attached to tasks/subprocesses and their
 * exception chains (forward BFS from boundary events through elements
 * only reachable from boundary events).
 *
 * These are rebuilt after the main flow, positioned below their host element.
 */

import type { BpmnElement, ElementRegistry } from '../bpmn-types';

// ── Types ──────────────────────────────────────────────────────────────────

/** A boundary event with its host and exception chain. */
export interface BoundaryEventInfo {
  /** The boundary event element. */
  boundaryEvent: BpmnElement;
  /** The host element this boundary event is attached to. */
  host: BpmnElement;
  /**
   * The exception chain: ordered list of element IDs reachable from
   * this boundary event that are NOT reachable from the main flow.
   * Does not include the boundary event itself.
   */
  exceptionChain: string[];
}

/** Adjacency maps for sequence flow analysis. */
interface FlowAdjacency {
  /** target ID → set of source IDs */
  incomingSources: Map<string, Set<string>>;
  /** source ID → set of target IDs */
  outgoingTargets: Map<string, Set<string>>;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Identify boundary events and their exception chains within a container.
 *
 * @param registry  The bpmn-js ElementRegistry service.
 * @param container Optional container to scope the analysis.
 * @returns         Array of BoundaryEventInfo for each boundary event.
 */
export function identifyBoundaryEvents(
  registry: ElementRegistry,
  container?: BpmnElement
): BoundaryEventInfo[] {
  const allElements: BpmnElement[] = registry.getAll();
  return identifyBoundaryEventsFromElements(allElements, container);
}

/**
 * Core implementation for boundary event identification.
 * Separated from registry wrapper for testability.
 */
export function identifyBoundaryEventsFromElements(
  allElements: BpmnElement[],
  container?: BpmnElement
): BoundaryEventInfo[] {
  const boundaryEvents = findBoundaryEvents(allElements, container);
  if (boundaryEvents.length === 0) return [];

  const adjacency = buildFlowAdjacency(allElements, container);
  const boundaryEventIds = new Set(boundaryEvents.map((be) => be.id));
  const exclusiveChainIds = computeExclusiveChainIds(boundaryEventIds, adjacency);

  return boundaryEvents.map((be) => ({
    boundaryEvent: be,
    host: be.host!,
    exceptionChain: traceExceptionChain(be.id, exclusiveChainIds, adjacency),
  }));
}

// ── Boundary event discovery ───────────────────────────────────────────────

/** Find boundary events scoped to the given container. */
function findBoundaryEvents(allElements: BpmnElement[], container?: BpmnElement): BpmnElement[] {
  return allElements.filter(
    (el) =>
      el.type === 'bpmn:BoundaryEvent' && !!el.host && (!container || el.host.parent === container)
  );
}

// ── Adjacency construction ─────────────────────────────────────────────────

/** Build incoming/outgoing adjacency maps from sequence flows. */
function buildFlowAdjacency(allElements: BpmnElement[], container?: BpmnElement): FlowAdjacency {
  const incomingSources = new Map<string, Set<string>>();
  const outgoingTargets = new Map<string, Set<string>>();

  for (const el of allElements) {
    if (el.type !== 'bpmn:SequenceFlow' || !el.source || !el.target) continue;
    if (container && el.parent !== container) continue;

    addToAdjacency(incomingSources, el.target.id, el.source.id);
    addToAdjacency(outgoingTargets, el.source.id, el.target.id);
  }

  return { incomingSources, outgoingTargets };
}

/** Add a value to a Set-valued map entry. */
function addToAdjacency(map: Map<string, Set<string>>, key: string, value: string): void {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key)!.add(value);
}

// ── Exclusive chain computation ────────────────────────────────────────────

/**
 * Compute all element IDs exclusively reachable from boundary events.
 *
 * An element is in an exception chain if ALL its incoming sequence flows
 * come from either boundary events or other exception chain elements.
 */
function computeExclusiveChainIds(
  boundaryEventIds: Set<string>,
  adjacency: FlowAdjacency
): Set<string> {
  const result = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    changed = expandFromSources(boundaryEventIds, result, boundaryEventIds, adjacency) || changed;
    changed = expandFromSources(result, result, boundaryEventIds, adjacency) || changed;
  }

  return result;
}

/**
 * Expand the chain set by checking outgoing targets of source IDs.
 * A target is added if ALL its incoming sources are in the chain or
 * are boundary events.
 */
function expandFromSources(
  sourceIds: Set<string>,
  chainIds: Set<string>,
  boundaryEventIds: Set<string>,
  adjacency: FlowAdjacency
): boolean {
  let changed = false;

  for (const srcId of sourceIds) {
    const targets = adjacency.outgoingTargets.get(srcId);
    if (!targets) continue;

    for (const targetId of targets) {
      if (chainIds.has(targetId)) continue;
      if (isExclusivelyFromChain(targetId, chainIds, boundaryEventIds, adjacency)) {
        chainIds.add(targetId);
        changed = true;
      }
    }
  }

  return changed;
}

/** Check if all incoming sources of a target are chain or boundary event nodes. */
function isExclusivelyFromChain(
  targetId: string,
  chainIds: Set<string>,
  boundaryEventIds: Set<string>,
  adjacency: FlowAdjacency
): boolean {
  const incoming = adjacency.incomingSources.get(targetId);
  if (!incoming) return false;
  return [...incoming].every((srcId) => chainIds.has(srcId) || boundaryEventIds.has(srcId));
}

// ── Exception chain tracing ────────────────────────────────────────────────

/**
 * Trace the exception chain for a specific boundary event via BFS.
 * Collects only elements in the exclusive chain set.
 */
function traceExceptionChain(
  boundaryEventId: string,
  exclusiveChainIds: Set<string>,
  adjacency: FlowAdjacency
): string[] {
  const chain: string[] = [];
  const visited = new Set<string>([boundaryEventId]);
  const queue = [boundaryEventId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const targets = adjacency.outgoingTargets.get(currentId);
    if (!targets) continue;

    for (const targetId of targets) {
      if (visited.has(targetId) || !exclusiveChainIds.has(targetId)) continue;
      visited.add(targetId);
      chain.push(targetId);
      queue.push(targetId);
    }
  }

  return chain;
}
