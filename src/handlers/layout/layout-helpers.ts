/**
 * Layout helpers: DI integrity checks, displacement stats, and result building.
 *
 * Extracted from layout-diagram.ts to keep it under the max-lines limit.
 */

import { type ToolResult } from '../../types';
import { jsonResult, getVisibleElements } from '../helpers';
import { getDefinitionsFromModeler } from '../../linter';
import { computeLaneCrossingMetrics } from '../../elk/api';
import { getElementSize } from '../../constants';

// ── Pixel grid snapping ────────────────────────────────────────────────────

/** Apply pixel-level grid snapping to all visible non-flow elements. */
export function applyPixelGridSnap(diagram: any, pixelGridSnap: number): void {
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const visibleElements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association') &&
      el.type !== 'bpmn:BoundaryEvent'
  );
  for (const el of visibleElements) {
    const snappedX = Math.round(el.x / pixelGridSnap) * pixelGridSnap;
    const snappedY = Math.round(el.y / pixelGridSnap) * pixelGridSnap;
    if (snappedX !== el.x || snappedY !== el.y) {
      modeling.moveElements([el], { x: snappedX - el.x, y: snappedY - el.y });
    }
  }
}

// ── Displacement stats for dry-run ─────────────────────────────────────────

export interface DisplacementStats {
  movedCount: number;
  maxDisplacement: number;
  avgDisplacement: number;
  displacements: Array<{ id: string; dx: number; dy: number; distance: number }>;
}

/** Compute layout displacement stats between original and laid-out element positions. */
export function computeDisplacementStats(
  originalPositions: Map<string, { x: number; y: number }>,
  elementRegistry: any
): DisplacementStats {
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  );

  const displacements: Array<{ id: string; dx: number; dy: number; distance: number }> = [];
  let maxDisplacement = 0;
  let totalDisplacement = 0;
  let movedCount = 0;

  for (const el of elements) {
    const orig = originalPositions.get(el.id);
    if (!orig) continue;
    const dx = (el.x ?? 0) - orig.x;
    const dy = (el.y ?? 0) - orig.y;
    const distance = Math.round(Math.sqrt(dx * dx + dy * dy));
    if (distance > 1) {
      movedCount++;
      displacements.push({ id: el.id, dx: Math.round(dx), dy: Math.round(dy), distance });
      if (distance > maxDisplacement) maxDisplacement = distance;
      totalDisplacement += distance;
    }
  }

  return {
    movedCount,
    maxDisplacement,
    avgDisplacement: movedCount > 0 ? Math.round(totalDisplacement / movedCount) : 0,
    displacements: displacements.sort((a, b) => b.distance - a.distance).slice(0, 10),
  };
}

// ── DI integrity check ────────────────────────────────────────────────────

/** BPMN types that must have a visual DI shape. */
const VISUAL_ELEMENT_TYPES = new Set([
  'bpmn:Task',
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:ScriptTask',
  'bpmn:ManualTask',
  'bpmn:BusinessRuleTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
  'bpmn:CallActivity',
  'bpmn:SubProcess',
  'bpmn:ExclusiveGateway',
  'bpmn:ParallelGateway',
  'bpmn:InclusiveGateway',
  'bpmn:EventBasedGateway',
  'bpmn:StartEvent',
  'bpmn:EndEvent',
  'bpmn:IntermediateCatchEvent',
  'bpmn:IntermediateThrowEvent',
  'bpmn:BoundaryEvent',
]);

function checkFlowElements(
  flowElements: any[],
  registeredIds: Set<string>,
  warnings: string[]
): void {
  for (const el of flowElements) {
    if (VISUAL_ELEMENT_TYPES.has(el.$type) && !registeredIds.has(el.id)) {
      const label = el.name ? `"${el.name}"` : el.id;
      warnings.push(
        `⚠️ DI integrity: ${label} (${el.$type}) exists in process but has no visual shape. ` +
          'It may be invisible in the diagram. Re-add with add_bpmn_element or re-import the diagram.'
      );
    }
    // Recurse into subprocesses
    if (el.flowElements) {
      checkFlowElements(el.flowElements, registeredIds, warnings);
    }
  }
}

/**
 * Check DI integrity: compare process-level flow elements against the
 * element registry.  Returns warnings for elements that exist in the
 * semantic model but have no visual representation (no DI shape).
 */
export function checkDiIntegrity(diagram: any, elementRegistry: any): string[] {
  const warnings: string[] = [];

  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions) return warnings;

    const registeredIds = new Set<string>();
    for (const el of elementRegistry.getAll()) {
      registeredIds.add(el.id);
    }

    const processes = (definitions.rootElements || []).filter(
      (el: any) => el.$type === 'bpmn:Process'
    );

    for (const process of processes) {
      checkFlowElements(process.flowElements || [], registeredIds, warnings);
    }

    // Also check participants' processes
    const collaborations = (definitions.rootElements || []).filter(
      (el: any) => el.$type === 'bpmn:Collaboration'
    );
    for (const collab of collaborations) {
      for (const participant of collab.participants || []) {
        if (participant.processRef?.flowElements) {
          checkFlowElements(participant.processRef.flowElements, registeredIds, warnings);
        }
      }
    }
  } catch {
    // Non-fatal: DI check failure should not break layout
  }

  return warnings;
}

// ── DI repair: create missing BPMNShape/BPMNEdge entries ───────────────────

/** BPMN types that are sequence flows requiring BPMNEdge entries. */
const SEQUENCE_FLOW_TYPE = 'bpmn:SequenceFlow';

/**
 * Collect flow elements missing from the element registry.
 * Returns separate arrays for shapes (flow nodes) and edges (sequence flows).
 */
function collectMissingDiElements(
  definitions: any,
  registeredIds: Set<string>
): {
  missingShapes: Array<{ id: string; type: string; name?: string }>;
  missingEdges: Array<{ id: string; sourceId?: string; targetId?: string }>;
} {
  const missingShapes: Array<{ id: string; type: string; name?: string }> = [];
  const missingEdges: Array<{ id: string; sourceId?: string; targetId?: string }> = [];

  function scan(flowElements: any[]): void {
    for (const el of flowElements) {
      if (!registeredIds.has(el.id)) {
        if (el.$type === SEQUENCE_FLOW_TYPE) {
          missingEdges.push({
            id: el.id,
            sourceId: el.sourceRef?.id,
            targetId: el.targetRef?.id,
          });
        } else if (VISUAL_ELEMENT_TYPES.has(el.$type)) {
          missingShapes.push({ id: el.id, type: el.$type, name: el.name });
        }
      }
      // Recurse into subprocesses
      if (el.flowElements) scan(el.flowElements);
    }
  }

  const processes = (definitions.rootElements || []).filter(
    (el: any) => el.$type === 'bpmn:Process'
  );
  for (const proc of processes) {
    scan(proc.flowElements || []);
  }

  const collaborations = (definitions.rootElements || []).filter(
    (el: any) => el.$type === 'bpmn:Collaboration'
  );
  for (const collab of collaborations) {
    for (const participant of collab.participants || []) {
      if (participant.processRef?.flowElements) {
        scan(participant.processRef.flowElements);
      }
    }
  }

  return { missingShapes, missingEdges };
}

/**
 * Build BPMNShape XML snippets for missing flow nodes.
 * Places shapes at staggered positions so ELK layout can reposition them.
 */
function buildShapeXml(missing: Array<{ id: string; type: string }>): string {
  const lines: string[] = [];
  let offsetX = 0;

  for (const el of missing) {
    const size = getElementSize(el.type);
    lines.push(
      `      <bpmndi:BPMNShape id="${el.id}_di" bpmnElement="${el.id}">`,
      `        <dc:Bounds x="${offsetX}" y="0" width="${size.width}" height="${size.height}" />`,
      `      </bpmndi:BPMNShape>`
    );
    offsetX += size.width + 50;
  }

  return lines.join('\n');
}

/**
 * Build BPMNEdge XML snippets for missing sequence flows.
 * Uses a simple 2-point waypoint at (0,0) → (100,0); layout will fix routing.
 */
function buildEdgeXml(
  missing: Array<{ id: string; sourceId?: string; targetId?: string }>
): string {
  const lines: string[] = [];

  for (const flow of missing) {
    lines.push(
      `      <bpmndi:BPMNEdge id="${flow.id}_di" bpmnElement="${flow.id}">`,
      `        <di:waypoint x="0" y="0" />`,
      `        <di:waypoint x="100" y="0" />`,
      `      </bpmndi:BPMNEdge>`
    );
  }

  return lines.join('\n');
}

/**
 * Repair missing DI elements before layout.
 *
 * Detects flow nodes and sequence flows in the semantic model that have
 * no corresponding BPMNShape / BPMNEdge in the DI section, injects
 * default entries into the XML, and re-imports it into the modeler so
 * that ELK layout can position them properly.
 *
 * Returns human-readable descriptions of what was repaired, or an empty
 * array when nothing was missing.
 */
export async function repairMissingDiShapes(diagram: any): Promise<string[]> {
  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions) return [];

    const elementRegistry = diagram.modeler.get('elementRegistry');
    const registeredIds = new Set<string>();
    for (const el of elementRegistry.getAll()) {
      registeredIds.add(el.id);
    }

    const { missingShapes, missingEdges } = collectMissingDiElements(definitions, registeredIds);

    if (missingShapes.length === 0 && missingEdges.length === 0) return [];

    // Export current XML
    const { xml } = await diagram.modeler.saveXML({ format: true });
    if (!xml) return [];

    // Build DI snippets to inject
    const shapeSnippet = missingShapes.length > 0 ? buildShapeXml(missingShapes) + '\n' : '';
    const edgeSnippet = missingEdges.length > 0 ? buildEdgeXml(missingEdges) + '\n' : '';
    const snippet = shapeSnippet + edgeSnippet;

    // Inject before closing </bpmndi:BPMNPlane>
    const marker = '</bpmndi:BPMNPlane>';
    if (!xml.includes(marker)) return [];

    const repairedXml = xml.replace(marker, snippet + '    ' + marker);

    // Re-import the repaired XML into the same modeler
    await diagram.modeler.importXML(repairedXml);
    diagram.xml = repairedXml;

    // Build repair log
    const repairs: string[] = [];
    for (const el of missingShapes) {
      const label = el.name ? `"${el.name}"` : el.id;
      repairs.push(`Repaired missing DI shape for ${label} (${el.type})`);
    }
    for (const flow of missingEdges) {
      repairs.push(
        `Repaired missing DI edge for ${flow.id}` +
          (flow.sourceId && flow.targetId ? ` (${flow.sourceId} → ${flow.targetId})` : '')
      );
    }
    return repairs;
  } catch {
    // Non-fatal: repair failure should not break layout
    return [];
  }
}

// ── DI deduplication in modeler state ──────────────────────────────────────

/**
 * Remove duplicate BPMNShape/BPMNEdge entries from the modeler's DI plane.
 *
 * When multiple operations create DI entries for the same bpmnElement, the
 * plane's `planeElement` array may contain duplicates.  This function scans
 * the array and removes earlier occurrences, keeping the last (most
 * up-to-date) entry for each referenced element.
 *
 * Returns the number of duplicate entries removed.
 */
export function deduplicateDiInModeler(diagram: any): number {
  try {
    const definitions = getDefinitionsFromModeler(diagram.modeler);
    if (!definitions?.diagrams?.[0]?.plane?.planeElement) return 0;

    const plane = definitions.diagrams[0].plane;
    const elements: any[] = plane.planeElement;

    // Map bpmnElement.id → last index
    const lastIndex = new Map<string, number>();
    for (let i = 0; i < elements.length; i++) {
      const refId = elements[i].bpmnElement?.id;
      if (refId) lastIndex.set(refId, i);
    }

    // Collect indices of earlier duplicates
    const toRemove: number[] = [];
    const seen = new Set<string>();
    for (let i = elements.length - 1; i >= 0; i--) {
      const refId = elements[i].bpmnElement?.id;
      if (!refId) continue;
      if (seen.has(refId)) {
        toRemove.push(i);
      }
      seen.add(refId);
    }

    if (toRemove.length === 0) return 0;

    // Remove from highest index first to preserve earlier indices
    toRemove.sort((a, b) => b - a);
    for (const idx of toRemove) {
      elements.splice(idx, 1);
    }

    return toRemove.length;
  } catch {
    return 0;
  }
}

// ── Build layout result ────────────────────────────────────────────────────

/** Build the nextSteps array, adding lane organization advice when relevant. */
function buildNextSteps(
  laneCrossingMetrics: ReturnType<typeof computeLaneCrossingMetrics>
): Array<{ tool: string; description: string }> {
  const steps: Array<{ tool: string; description: string }> = [
    {
      tool: 'export_bpmn',
      description:
        'Diagram layout is complete. Use export_bpmn with format and filePath to save the diagram.',
    },
  ];

  if (laneCrossingMetrics && laneCrossingMetrics.laneCoherenceScore < 70) {
    steps.push({
      tool: 'validate_bpmn_lane_organization',
      description: `Lane coherence score is ${laneCrossingMetrics.laneCoherenceScore}% (below 70%). Run validate_bpmn_lane_organization for detailed lane improvement suggestions.`,
    });
  }

  return steps;
}

/** Build the structured layout result JSON with crossing metrics and lane metrics. */
export function buildLayoutResult(params: {
  diagramId: string;
  scopeElementId?: string;
  elementIds?: string[];
  elementCount: number;
  labelsMoved: number;
  layoutResult: { crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> };
  elementRegistry: any;
  usedDeterministic?: boolean;
  diWarnings?: string[];
}): ToolResult {
  const {
    diagramId,
    scopeElementId,
    elementIds,
    elementCount,
    labelsMoved,
    layoutResult,
    elementRegistry,
    usedDeterministic,
    diWarnings,
  } = params;
  const crossingCount = layoutResult.crossingFlows ?? 0;
  const crossingPairs = layoutResult.crossingFlowPairs ?? [];
  const laneCrossingMetrics = computeLaneCrossingMetrics(elementRegistry);

  return jsonResult({
    success: true,
    elementCount,
    labelsMoved,
    ...(usedDeterministic ? { layoutStrategy: 'deterministic' } : {}),
    ...(crossingCount > 0
      ? {
          crossingFlows: crossingCount,
          crossingFlowPairs: crossingPairs,
          warning: `${crossingCount} crossing sequence flow(s) detected — consider restructuring the process`,
        }
      : {}),
    ...(laneCrossingMetrics
      ? {
          laneCrossingMetrics: {
            totalLaneFlows: laneCrossingMetrics.totalLaneFlows,
            crossingLaneFlows: laneCrossingMetrics.crossingLaneFlows,
            laneCoherenceScore: laneCrossingMetrics.laneCoherenceScore,
            ...(laneCrossingMetrics.crossingFlowIds
              ? { crossingFlowIds: laneCrossingMetrics.crossingFlowIds }
              : {}),
          },
        }
      : {}),
    message: `Layout applied to diagram ${diagramId}${scopeElementId ? ` (scoped to ${scopeElementId})` : ''}${elementIds ? ` (${elementIds.length} elements)` : ''}${usedDeterministic ? ' (deterministic)' : ''} — ${elementCount} elements arranged`,
    ...(diWarnings && diWarnings.length > 0 ? { diWarnings } : {}),
    nextSteps: buildNextSteps(laneCrossingMetrics),
  });
}
