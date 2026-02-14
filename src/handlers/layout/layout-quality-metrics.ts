/**
 * Layout quality metrics and container sizing analysis.
 *
 * Provides post-layout quality feedback including:
 * - Container (pool/lane) overflow detection with sizing recommendations
 * - Flow orthogonality and length metrics
 * - Element density per lane
 *
 * Extracted from layout-helpers.ts to keep file sizes under the max-lines limit.
 */

// ── Pool/Lane overflow detection ───────────────────────────────────────────

/** Margin (px) between element extent and pool/lane edge considered "tight". */
const OVERFLOW_MARGIN = 30;

export interface ContainerSizingIssue {
  containerId: string;
  containerName: string;
  containerType: 'pool' | 'lane';
  currentWidth: number;
  currentHeight: number;
  recommendedWidth: number;
  recommendedHeight: number;
  severity: 'warning' | 'info';
  message: string;
}

/**
 * Detect pools and lanes whose bounds are too small for their contained elements.
 *
 * Returns actionable sizing issues with current and recommended dimensions.
 */
export function detectContainerSizingIssues(elementRegistry: any): ContainerSizingIssue[] {
  const issues: ContainerSizingIssue[] = [];

  // Check participants (pools)
  const participants = elementRegistry.filter(
    (el: any) => el.type === 'bpmn:Participant' && el.children && el.children.length > 0
  );

  for (const pool of participants) {
    const childExtent = computeChildExtent(pool.children);
    if (!childExtent) continue;

    const recommendedW = Math.max(pool.width, childExtent.maxX - pool.x + OVERFLOW_MARGIN);
    const recommendedH = Math.max(pool.height, childExtent.maxY - pool.y + OVERFLOW_MARGIN);

    if (recommendedW > pool.width + 5 || recommendedH > pool.height + 5) {
      const poolName = pool.businessObject?.name || pool.id;
      issues.push({
        containerId: pool.id,
        containerName: poolName,
        containerType: 'pool',
        currentWidth: pool.width,
        currentHeight: pool.height,
        recommendedWidth: Math.ceil(recommendedW / 10) * 10,
        recommendedHeight: Math.ceil(recommendedH / 10) * 10,
        severity: 'warning',
        message:
          `Pool "${poolName}" (${pool.width}×${pool.height}px) is too small for its elements. ` +
          `Recommended: ${Math.ceil(recommendedW / 10) * 10}×${Math.ceil(recommendedH / 10) * 10}px. ` +
          `Use move_bpmn_element with width/height to resize.`,
      });
    }
  }

  // Check lanes
  const lanes = elementRegistry.filter((el: any) => el.type === 'bpmn:Lane');

  for (const lane of lanes) {
    if (!lane.children || lane.children.length === 0) continue;

    const childExtent = computeChildExtent(lane.children);
    if (!childExtent) continue;

    const recommendedH = Math.max(lane.height, childExtent.maxY - lane.y + OVERFLOW_MARGIN);

    if (recommendedH > lane.height + 5) {
      const laneName = lane.businessObject?.name || lane.id;
      issues.push({
        containerId: lane.id,
        containerName: laneName,
        containerType: 'lane',
        currentWidth: lane.width,
        currentHeight: lane.height,
        recommendedWidth: lane.width,
        recommendedHeight: Math.ceil(recommendedH / 10) * 10,
        severity: 'info',
        message:
          `Lane "${laneName}" height (${lane.height}px) is tight for its elements. ` +
          `Recommended height: ${Math.ceil(recommendedH / 10) * 10}px.`,
      });
    }
  }

  return issues;
}

/**
 * Compute the bounding extent of child elements within a container.
 * Returns the maximum x+width and y+height of all children.
 */
function computeChildExtent(children: any[]): { maxX: number; maxY: number } | null {
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const child of children) {
    // Skip connections and lanes (lanes are containers, not content)
    if (
      child.type?.includes('SequenceFlow') ||
      child.type?.includes('MessageFlow') ||
      child.type?.includes('Association') ||
      child.type === 'bpmn:Lane'
    ) {
      continue;
    }

    if (child.x !== undefined && child.y !== undefined) {
      const right = child.x + (child.width || 0);
      const bottom = child.y + (child.height || 0);
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
      found = true;
    }
  }

  return found ? { maxX, maxY } : null;
}

// ── Layout quality metrics ─────────────────────────────────────────────────

export interface LayoutQualityMetrics {
  /** Average length of sequence flows in pixels. */
  avgFlowLength: number;
  /** Percentage of sequence flows that are orthogonal (straight or right-angle). */
  orthogonalFlowPercent: number;
  /** Number of flow nodes (tasks, events, gateways) per lane, or total if no lanes. */
  elementDensity: Record<string, number>;
}

/**
 * Compute layout quality metrics for post-layout feedback.
 *
 * Metrics include average flow length, orthogonal flow percentage,
 * and element density per lane (or overall).
 */
export function computeLayoutQualityMetrics(elementRegistry: any): LayoutQualityMetrics {
  const allElements = elementRegistry.getAll();

  // --- Flow length and orthogonality ---
  const flows = allElements.filter(
    (el: any) => el.type === 'bpmn:SequenceFlow' && el.waypoints && el.waypoints.length >= 2
  );

  let totalLength = 0;
  let orthogonalCount = 0;

  for (const flow of flows) {
    const wps: Array<{ x: number; y: number }> = flow.waypoints;
    let flowLength = 0;
    let isOrthogonal = true;

    for (let i = 1; i < wps.length; i++) {
      const dx = wps[i].x - wps[i - 1].x;
      const dy = wps[i].y - wps[i - 1].y;
      flowLength += Math.sqrt(dx * dx + dy * dy);

      // Segment is orthogonal if horizontal or vertical (within 2px tolerance)
      if (Math.abs(dx) > 2 && Math.abs(dy) > 2) {
        isOrthogonal = false;
      }
    }

    totalLength += flowLength;
    if (isOrthogonal) orthogonalCount++;
  }

  const avgFlowLength = flows.length > 0 ? Math.round(totalLength / flows.length) : 0;
  const orthogonalFlowPercent =
    flows.length > 0 ? Math.round((orthogonalCount / flows.length) * 100) : 100;

  // --- Element density per lane (or total) ---
  const density: Record<string, number> = {};
  const flowNodes = allElements.filter(
    (el: any) =>
      el.type &&
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:Participant' &&
      el.type !== 'bpmn:Lane' &&
      el.type !== 'label' &&
      el.type !== 'bpmn:Collaboration' &&
      el.type !== 'bpmn:Process'
  );

  const lanes = allElements.filter((el: any) => el.type === 'bpmn:Lane');
  if (lanes.length > 0) {
    for (const lane of lanes) {
      const laneName = lane.businessObject?.name || lane.id;
      const childIds = new Set((lane.children || []).map((c: any) => c.id));
      density[laneName] = flowNodes.filter((n: any) => childIds.has(n.id)).length;
    }
  } else {
    density['total'] = flowNodes.length;
  }

  return { avgFlowLength, orthogonalFlowPercent, elementDensity: density };
}
