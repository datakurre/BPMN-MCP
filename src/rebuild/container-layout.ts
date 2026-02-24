/**
 * Container and boundary event layout utilities for the rebuild engine.
 *
 * Handles:
 * - Boundary event positioning on host bottom borders
 * - Exception chain placement below boundary events
 * - Subprocess resizing to fit internal elements
 * - Participant pool stacking for collaborations
 * - Message flow routing after pool positioning
 */

import type { BpmnElement, ElementRegistry, Modeling } from '../bpmn-types';
import type { BoundaryEventInfo } from './boundary';
import type { RebuildResult } from './engine';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Gap (px) between host task bottom edge and exception chain element
 * top edge.  Matches ELK_BOUNDARY_NODE_SPACING from constants.ts.
 */
const BOUNDARY_GAP = 40;

// ── Element movement ───────────────────────────────────────────────────────

/**
 * Move an element so its centre is at the given target position.
 * Returns true if the element was actually moved (delta ≥ 1px).
 *
 * For boundary events, uses direct position manipulation instead of
 * `modeling.moveElements()` to prevent bpmn-js's `AttachSupport`
 * behaviour from detaching the boundary event from its host.
 */
export function moveElementTo(
  modeling: Modeling,
  element: BpmnElement,
  targetCenter: { x: number; y: number }
): boolean {
  const currentCenterX = element.x + element.width / 2;
  const currentCenterY = element.y + element.height / 2;

  const dx = Math.round(targetCenter.x - currentCenterX);
  const dy = Math.round(targetCenter.y - currentCenterY);

  if (dx === 0 && dy === 0) return false;

  // For boundary events, we must avoid modeling.moveElements() because
  // bpmn-js's AttachSupport detaches the boundary event from its host
  // and converts it to an IntermediateCatchEvent.  Instead, we update
  // the element's position directly and sync the DI bounds.
  if (element.type === 'bpmn:BoundaryEvent') {
    element.x += dx;
    element.y += dy;
    // Sync the diagram interchange (DI) shape bounds
    const di = (element as any).di;
    if (di?.bounds) {
      di.bounds.x = element.x;
      di.bounds.y = element.y;
    }
    return true;
  }

  modeling.moveElements([element], { x: dx, y: dy });
  return true;
}

// ── Exception chain helpers ────────────────────────────────────────────────

/** Collect all element IDs that belong to exception chains. */
export function collectExceptionChainIds(boundaryInfos: BoundaryEventInfo[]): Set<string> {
  const ids = new Set<string>();
  for (const info of boundaryInfos) {
    for (const id of info.exceptionChain) {
      ids.add(id);
    }
  }
  return ids;
}

// ── Boundary event positioning ─────────────────────────────────────────────

/**
 * Position boundary events on their host's bottom border and lay out
 * exception chain elements as linear chains below the host.
 */
export function positionBoundaryEventsAndChains(
  boundaryInfos: BoundaryEventInfo[],
  _mainFlowPositions: Map<string, { x: number; y: number }>,
  registry: ElementRegistry,
  modeling: Modeling,
  gap: number
): RebuildResult {
  let repositionedCount = 0;
  let reroutedCount = 0;

  // Group boundary events by host for spreading
  const byHost = new Map<string, BoundaryEventInfo[]>();
  for (const info of boundaryInfos) {
    const hostId = info.host.id;
    if (!byHost.has(hostId)) byHost.set(hostId, []);
    byHost.get(hostId)!.push(info);
  }

  for (const [, infos] of byHost) {
    const host = infos[0].host;
    const hostCenterX = host.x + host.width / 2;
    const hostBottom = host.y + host.height;

    // Spread boundary events along the host's bottom border
    const count = infos.length;
    for (let i = 0; i < count; i++) {
      const info = infos[i];
      const be = info.boundaryEvent;

      // Compute X: spread evenly along bottom edge
      const spreadX = count === 1 ? hostCenterX : host.x + ((i + 1) / (count + 1)) * host.width;

      // Position boundary event at host's bottom border
      const beCenter = { x: spreadX, y: hostBottom };
      if (moveElementTo(modeling, be, beCenter)) {
        repositionedCount++;
      }

      // Position exception chain elements below the host
      const chainResult = positionExceptionChain(info, beCenter, host, registry, modeling, gap);
      repositionedCount += chainResult.repositionedCount;
      reroutedCount += chainResult.reroutedCount;
    }
  }

  return { repositionedCount, reroutedCount };
}

/**
 * Position exception chain elements as a linear chain starting from
 * a boundary event.  Elements are placed below the host at the same Y,
 * progressing left-to-right with standard gap.
 */
function positionExceptionChain(
  info: BoundaryEventInfo,
  beCenter: { x: number; y: number },
  host: BpmnElement,
  registry: ElementRegistry,
  modeling: Modeling,
  gap: number
): RebuildResult {
  let repositionedCount = 0;
  let reroutedCount = 0;

  if (info.exceptionChain.length === 0) return { repositionedCount, reroutedCount };

  // Compute a single center Y for the entire chain based on the tallest element
  let maxHeight = 0;
  for (const chainId of info.exceptionChain) {
    const el = registry.get(chainId);
    if (el) maxHeight = Math.max(maxHeight, el.height);
  }
  const chainCenterY = host.y + host.height + BOUNDARY_GAP + maxHeight / 2;

  let prevCenter = beCenter;
  let prevHalfWidth = info.boundaryEvent.width / 2;

  for (const chainId of info.exceptionChain) {
    const chainElement = registry.get(chainId);
    if (!chainElement) continue;

    const chainCenterX = prevCenter.x + prevHalfWidth + gap + chainElement.width / 2;

    if (moveElementTo(modeling, chainElement, { x: chainCenterX, y: chainCenterY })) {
      repositionedCount++;
    }

    prevCenter = { x: chainCenterX, y: chainCenterY };
    prevHalfWidth = chainElement.width / 2;
  }

  // Layout exception chain connections (boundary event → chain elements)
  const beOutgoing = info.boundaryEvent.outgoing ?? [];
  for (const conn of beOutgoing) {
    const connElement = registry.get(conn.id);
    if (connElement) {
      modeling.layoutConnection(connElement);
      reroutedCount++;
    }
  }

  // Layout connections within the exception chain
  for (const chainId of info.exceptionChain) {
    const chainElement = registry.get(chainId);
    if (!chainElement) continue;
    const outgoing = chainElement.outgoing ?? [];
    for (const conn of outgoing) {
      const connElement = registry.get(conn.id);
      if (connElement) {
        modeling.layoutConnection(connElement);
        reroutedCount++;
      }
    }
  }

  return { repositionedCount, reroutedCount };
}

// ── Subprocess resizing ────────────────────────────────────────────────────

/**
 * Resize an expanded subprocess to fit its internal elements with padding.
 * Computes the bounding box of all child elements and resizes the
 * subprocess shape to encompass them.
 */
export function resizeSubprocessToFit(
  modeling: Modeling,
  registry: ElementRegistry,
  subprocess: BpmnElement,
  padding: number
): void {
  const allElements: BpmnElement[] = registry.getAll();
  const children = allElements.filter(
    (el) => el.parent === subprocess && el.type !== 'bpmn:SequenceFlow' && el.type !== 'label'
  );

  if (children.length === 0) return;

  // Compute bounding box of children
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const child of children) {
    minX = Math.min(minX, child.x);
    minY = Math.min(minY, child.y);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }

  // New bounds with padding
  const newBounds = {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + 2 * padding,
    height: maxY - minY + 2 * padding,
  };

  modeling.resizeShape(subprocess, newBounds);
}

// ── Pool stacking ──────────────────────────────────────────────────────────

/**
 * Stack participant pools vertically with consistent gap.
 * The first pool is positioned at the top, subsequent pools below.
 */
export function stackPools(
  participants: BpmnElement[],
  modeling: Modeling,
  poolGap: number
): number {
  if (participants.length <= 1) return 0;

  let repositioned = 0;

  // Sort participants by their original Y position
  const sorted = [...participants].sort((a, b) => a.y - b.y);

  // Stack from top — first pool stays, subsequent pools stack below
  let nextY = sorted[0].y + sorted[0].height + poolGap;

  for (let i = 1; i < sorted.length; i++) {
    const pool = sorted[i];
    if (pool.y !== nextY) {
      const dy = nextY - pool.y;
      modeling.moveElements([pool], { x: 0, y: dy });
      repositioned++;
    }
    nextY = pool.y + pool.height + poolGap;
  }

  return repositioned;
}

// ── Event subprocess positioning ───────────────────────────────────────────

/**
 * Detect event subprocesses (triggeredByEvent=true) among direct
 * children of a container.
 */
export function getEventSubprocessIds(
  registry: ElementRegistry,
  container: BpmnElement
): Set<string> {
  const ids = new Set<string>();
  const allElements: BpmnElement[] = registry.getAll();

  for (const el of allElements) {
    if (el.parent !== container) continue;
    if (el.type === 'bpmn:SubProcess' && el.businessObject?.triggeredByEvent === true) {
      ids.add(el.id);
    }
  }

  return ids;
}

/**
 * Position event subprocesses below the main flow bounding box.
 *
 * Called after the main flow is positioned.  Event subprocesses have
 * already been rebuilt internally (inside-out) and resized, so their
 * width/height are known.
 */
export function positionEventSubprocesses(
  eventSubprocessIds: Set<string>,
  registry: ElementRegistry,
  modeling: Modeling,
  container: BpmnElement,
  gap: number,
  originX: number
): number {
  if (eventSubprocessIds.size === 0) return 0;

  // Find the bottom of the main flow (exclude event subprocesses)
  const allElements: BpmnElement[] = registry.getAll();
  let maxBottomY = 0;

  for (const el of allElements) {
    if (el.parent !== container) continue;
    if (eventSubprocessIds.has(el.id)) continue;
    if (el.type === 'bpmn:SequenceFlow' || el.type === 'label') continue;
    if (el.type === 'bpmn:Lane' || el.type === 'bpmn:LaneSet') continue;
    maxBottomY = Math.max(maxBottomY, el.y + el.height);
  }

  // Position event subprocesses below the main flow, left-to-right
  let repositioned = 0;
  let currentX = originX;

  for (const id of eventSubprocessIds) {
    const el = registry.get(id);
    if (!el) continue;

    const targetY = maxBottomY + gap + el.height / 2;
    const targetX = currentX + el.width / 2;

    if (moveElementTo(modeling, el, { x: targetX, y: targetY })) {
      repositioned++;
    }

    currentX += el.width + gap;
  }

  return repositioned;
}

// ── Message flow layout ────────────────────────────────────────────────────

/**
 * Layout all message flows in the diagram (cross-pool connections).
 * Called after all pools are positioned.
 */
export function layoutMessageFlows(registry: ElementRegistry, modeling: Modeling): number {
  const allElements: BpmnElement[] = registry.getAll();
  let count = 0;

  for (const el of allElements) {
    if (el.type === 'bpmn:MessageFlow') {
      modeling.layoutConnection(el);
      count++;
    }
  }

  return count;
}
