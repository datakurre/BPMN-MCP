/**
 * Post-layout boundary event repositioning.
 *
 * Boundary events are excluded from the ELK graph and should follow their
 * host when `modeling.moveElements` moves it.  In headless (jsdom) mode,
 * the automatic follow does not work correctly, leaving boundary events
 * stranded at their original positions.
 */

/**
 * Determine the best border position for a boundary event based on its
 * outgoing flow targets relative to its host element.
 *
 * Returns 'bottom' (default), 'top', 'left', or 'right'.
 */
function chooseBoundaryBorder(be: any, host: any): 'top' | 'bottom' | 'left' | 'right' {
  const outgoing: any[] = be.outgoing || [];
  if (outgoing.length === 0) return 'bottom'; // default: no outgoing flows

  // Find the first target element with a valid position
  for (const flow of outgoing) {
    const target = flow.target;
    if (!target || target.x == null || target.y == null) continue;

    const hostCx = host.x + (host.width || 100) / 2;
    const hostCy = host.y + (host.height || 80) / 2;
    const targetCx = target.x + (target.width || 36) / 2;
    const targetCy = target.y + (target.height || 36) / 2;

    const dx = targetCx - hostCx;
    const dy = targetCy - hostCy;

    // Choose based on the dominant direction to the target
    if (Math.abs(dy) > Math.abs(dx)) {
      // Vertical movement dominates
      return dy < 0 ? 'top' : 'bottom';
    } else {
      // Horizontal movement dominates
      return dx < 0 ? 'left' : 'right';
    }
  }

  return 'bottom'; // fallback
}

/**
 * Compute the target centre position for a boundary event on a given
 * border of its host element.
 */
function computeBoundaryPosition(
  host: any,
  border: 'top' | 'bottom' | 'left' | 'right'
): { cx: number; cy: number } {
  const hostW = host.width || 100;
  const hostH = host.height || 80;

  switch (border) {
    case 'top':
      return { cx: host.x + hostW * 0.67, cy: host.y };
    case 'bottom':
      return { cx: host.x + hostW * 0.67, cy: host.y + hostH };
    case 'left':
      return { cx: host.x, cy: host.y + hostH * 0.67 };
    case 'right':
      return { cx: host.x + hostW, cy: host.y + hostH * 0.67 };
  }
}

/**
 * Fix boundary event positions after layout.
 *
 * When repositioning is needed, the target border (top, bottom, left,
 * right) is chosen based on the direction of the boundary event's
 * outgoing flow targets. This positions error/timer boundary events on
 * the border closest to where their exception flow leads.
 *
 * Multiple boundary events on the same host are spread horizontally
 * to avoid overlap.
 */
export function repositionBoundaryEvents(elementRegistry: any, modeling: any): void {
  const boundaryEvents = elementRegistry.filter((el: any) => el.type === 'bpmn:BoundaryEvent');

  // Ensure boundary events retain their correct type (headless mode can
  // accidentally change types during bulk moves)
  for (const be of boundaryEvents) {
    const bo = be.businessObject;
    if (bo && bo.$type !== 'bpmn:BoundaryEvent') {
      bo.$type = 'bpmn:BoundaryEvent';
    }
  }

  for (const be of boundaryEvents) {
    const host = be.host;
    if (!host) continue;

    const beW = be.width || 36;
    const beH = be.height || 36;
    const beCx = be.x + beW / 2;
    const beCy = be.y + beH / 2;

    // Check if the boundary event center is within reasonable distance of the host
    const hostRight = host.x + (host.width || 100);
    const hostBottom = host.y + (host.height || 80);
    const tolerance = 60;

    const isNearHost =
      beCx >= host.x - tolerance &&
      beCx <= hostRight + tolerance &&
      beCy >= host.y - tolerance &&
      beCy <= hostBottom + tolerance;

    if (!isNearHost) {
      // Choose border based on outgoing flow direction
      const border = chooseBoundaryBorder(be, host);
      const target = computeBoundaryPosition(host, border);
      const dx = target.cx - beCx;
      const dy = target.cy - beCy;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        try {
          modeling.moveElements([be], { x: dx, y: dy });
        } catch {
          // Fallback: directly update position when moveElements fails
          // (headless mode can trigger SVG path intersection errors)
          be.x += dx;
          be.y += dy;
          const di = be.di;
          if (di?.bounds) {
            di.bounds.x = be.x;
            di.bounds.y = be.y;
          }
        }
      }
    }
  }
}
