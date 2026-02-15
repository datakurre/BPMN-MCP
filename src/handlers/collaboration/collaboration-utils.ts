/**
 * Shared utilities for collaboration handlers.
 *
 * Contains helpers used by multiple collaboration-related handlers
 * to avoid code duplication.
 */

import type {
  BpmnElement,
  BusinessObject,
  Canvas,
  ElementRegistry,
  Moddle,
} from '../../bpmn-types';
import { getParticipants } from '../diagram-access';

/**
 * Ensure an expanded participant has a processRef.
 *
 * bpmn-js auto-creates a processRef for the first participant (wrapping the
 * existing process), but subsequent participants may not get one in the
 * headless environment. This helper creates and links a new bpmn:Process
 * when processRef is missing.
 */
export function ensureProcessRef(
  moddle: Moddle,
  canvas: Canvas,
  element: BpmnElement,
  collapsed?: boolean
): void {
  const bo = element.businessObject;
  if (bo.processRef) return;
  if (collapsed) return;

  const definitions = canvas.getRootElement()?.businessObject?.$parent as
    | BusinessObject
    | undefined;
  if (!definitions) return;

  const processId = `Process_${bo.id || element.id}`;
  const process = moddle.create('bpmn:Process', { id: processId, isExecutable: false });
  process.$parent = definitions;
  const rootElements = (definitions.rootElements ?? []) as BusinessObject[];
  if (!definitions.rootElements) definitions.rootElements = rootElements;
  rootElements.push(process);
  bo.processRef = process;
}

/**
 * Find the bpmn:Process for a participant (or the root process).
 *
 * Used by lane-related tools to locate the process that contains flow elements.
 * If participantId is provided, looks up that specific participant's processRef.
 * Otherwise falls back to the first participant or the root element.
 */
export function findProcess(
  elementRegistry: ElementRegistry,
  canvas: Canvas,
  participantId?: string
): BusinessObject | null {
  if (participantId) {
    const p = elementRegistry.get(participantId);
    if (p?.businessObject?.processRef) return p.businessObject.processRef;
  }
  const participants = getParticipants(elementRegistry);
  if (participants.length > 0) return participants[0].businessObject?.processRef ?? null;
  return canvas.getRootElement()?.businessObject ?? null;
}
