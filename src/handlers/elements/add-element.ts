/**
 * Handler for add_bpmn_element tool.
 */

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  jsonResult,
  syncXml,
  generateDescriptiveId,
  generateFlowId,
  validateArgs,
  createBusinessObject,
  fixConnectionId,
  buildElementCounts,
  getVisibleElements,
  getService,
} from '../helpers';
import { STANDARD_BPMN_GAP, getElementSize } from '../../constants';
import { appendLintFeedback } from '../../linter';
import { handleInsertElement } from './insert-element';
import { handleSetEventDefinition } from '../properties/set-event-definition';
import {
  shiftDownstreamElements,
  snapToLane,
  createAndPlaceElement,
  avoidCollision,
} from './add-element-helpers';
import { getTypeSpecificHints, getNamingHint } from '../type-hints';
import { validateElementType, ALLOWED_ELEMENT_TYPES } from '../element-type-validation';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export interface AddElementArgs {
  diagramId: string;
  elementType: string;
  name?: string;
  x?: number;
  y?: number;
  hostElementId?: string;
  afterElementId?: string;
  participantId?: string;
  /** Insert into an existing sequence flow, splitting and reconnecting automatically. */
  flowId?: string;
  /** For SubProcess: true = expanded (large, inline children), false = collapsed (small, separate drilldown plane). Default: true. */
  isExpanded?: boolean;
  /** When afterElementId is set, automatically create a sequence flow from the reference element. Default: true. */
  autoConnect?: boolean;
  /** Place the element into a specific lane (auto-centers vertically within the lane). */
  laneId?: string;
  /** When true, reject creation if another element with the same type and name already exists. Default: false. */
  ensureUnique?: boolean;
  /** Boundary event shorthand: set event definition type in one call. */
  eventDefinitionType?: string;
  /** Boundary event shorthand: event definition properties (timer, condition, etc.). */
  eventDefinitionProperties?: Record<string, unknown>;
  /** Boundary event shorthand: error reference for ErrorEventDefinition. */
  errorRef?: { id: string; name?: string; errorCode?: string };
  /** Boundary event shorthand: message reference for MessageEventDefinition. */
  messageRef?: { id: string; name?: string };
  /** Boundary event shorthand: signal reference for SignalEventDefinition. */
  signalRef?: { id: string; name?: string };
  /** Boundary event shorthand: escalation reference for EscalationEventDefinition. */
  escalationRef?: { id: string; name?: string; escalationCode?: string };
}

// ── Main handler ───────────────────────────────────────────────────────────

// eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity
export async function handleAddElement(args: AddElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementType']);
  validateElementType(args.elementType, ALLOWED_ELEMENT_TYPES);

  // ── Validate incompatible argument combinations ────────────────────────
  if (args.elementType === 'bpmn:BoundaryEvent' && !args.hostElementId) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'BoundaryEvent requires hostElementId to specify the element to attach to. ' +
        'Use hostElementId to reference the task or subprocess this boundary event should be attached to.'
    );
  }

  if (args.elementType === 'bpmn:BoundaryEvent' && args.afterElementId) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'BoundaryEvent cannot use afterElementId — boundary events are positioned relative to their host element. ' +
        'Use hostElementId instead.'
    );
  }

  if (args.flowId && args.afterElementId) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Cannot use both flowId and afterElementId. flowId inserts into an existing sequence flow; ' +
        'afterElementId positions the element after another element. Choose one.'
    );
  }

  if (args.flowId && (args.x !== undefined || args.y !== undefined)) {
    // Not an error — just ignored. flowId overrides x/y positioning.
    // Documented in the tool description.
  }

  if (args.afterElementId && (args.x !== undefined || args.y !== undefined)) {
    // Not an error — afterElementId auto-positions relative to the reference element.
    // x/y are ignored. We capture this to include a warning in the response.
  }

  if (args.eventDefinitionType && !args.elementType.includes('Event')) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `eventDefinitionType can only be used with event element types, but elementType is "${args.elementType}". ` +
        'Use bpmn:StartEvent, bpmn:EndEvent, bpmn:IntermediateCatchEvent, bpmn:IntermediateThrowEvent, or bpmn:BoundaryEvent.'
    );
  }

  // Delegate to insert-into-flow handler when flowId is provided
  const { flowId } = args;
  if (flowId) {
    return handleInsertElement({
      diagramId: args.diagramId,
      flowId,
      elementType: args.elementType,
      name: args.name,
    });
  }

  const {
    diagramId,
    elementType,
    name: elementName,
    hostElementId,
    afterElementId,
    participantId,
  } = args;
  // SubProcess defaults to expanded (true) unless explicitly set to false
  const isExpanded = elementType === 'bpmn:SubProcess' ? args.isExpanded !== false : undefined;
  let { x = 100, y = 100 } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // ensureUnique: reject creation if another element with same type+name exists
  if (args.ensureUnique && elementName) {
    const duplicates = getVisibleElements(elementRegistry).filter(
      (el: any) => el.type === elementType && el.businessObject?.name === elementName
    );
    if (duplicates.length > 0) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `ensureUnique: an element with type ${elementType} and name "${elementName}" already exists: ${duplicates.map((d: any) => d.id).join(', ')}. ` +
          `Set ensureUnique to false to allow duplicates.`
      );
    }
  }

  // Auto-position after another element if requested
  if (afterElementId) {
    const afterEl = elementRegistry.get(afterElementId);
    if (afterEl) {
      const afterSize = getElementSize(afterEl.type || elementType);
      x = afterEl.x + (afterEl.width || afterSize.width) + STANDARD_BPMN_GAP;
      y = afterEl.y + (afterEl.height || afterSize.height) / 2;

      // Smart insertion: shift downstream elements to the right to prevent overlap
      const newSize = getElementSize(elementType);
      shiftDownstreamElements(
        elementRegistry,
        modeling,
        x,
        newSize.width + STANDARD_BPMN_GAP,
        afterElementId
      );
    }
  }

  // Generate a descriptive ID (named → UserTask_EnterName, collision → UserTask_<random7>_EnterName, unnamed → UserTask_<random7>)
  const descriptiveId = generateDescriptiveId(elementRegistry, elementType, elementName);

  // Lane-aware Y snapping: if the target position is inside a lane,
  // ensure the element stays within lane boundaries.
  const elementSize = getElementSize(elementType);
  const laneSnap = snapToLane(elementRegistry, x, y, elementSize.height);
  y = laneSnap.y;

  // Explicit laneId: override Y to center the element within the specified lane
  let assignToLaneId: string | undefined;
  if (args.laneId) {
    const targetLane = requireElement(elementRegistry, args.laneId);
    if (targetLane.type !== 'bpmn:Lane') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Target element ${args.laneId} is not a Lane (got: ${targetLane.type})`
      );
    }
    // Center the element vertically in the lane
    const laneCy = targetLane.y + (targetLane.height || 0) / 2;
    y = laneCy;
    assignToLaneId = args.laneId;
  }

  // Collision avoidance: shift right if position overlaps an existing element.
  // Only when using default placement (no explicit x/y, no afterElementId, no host).
  const usingDefaultPosition = args.x === undefined && args.y === undefined;
  if (usingDefaultPosition && !hostElementId && !afterElementId) {
    const avoided = avoidCollision(elementRegistry, x, y, elementSize.width, elementSize.height);
    x = avoided.x;
    y = avoided.y;
  }

  // Pre-create the business object with our descriptive ID so the
  // exported XML ID matches the element ID returned to callers.
  const businessObject = createBusinessObject(diagram.modeler, elementType, descriptiveId);

  const { createdElement, hostInfo } = createAndPlaceElement({
    diagram,
    elementType,
    descriptiveId,
    businessObject,
    x,
    y,
    hostElementId,
    participantId,
    isExpanded,
  });

  if (elementName) {
    modeling.updateProperties(createdElement, { name: elementName });
  }

  // Register element in lane's flowNodeRef list if laneId was specified
  if (assignToLaneId) {
    const targetLane = elementRegistry.get(assignToLaneId);
    if (targetLane?.businessObject) {
      const refs: unknown[] =
        (targetLane.businessObject.flowNodeRef as unknown[] | undefined) || [];
      if (!targetLane.businessObject.flowNodeRef) {
        targetLane.businessObject.flowNodeRef = refs;
      }
      const elemBo = createdElement.businessObject;
      if (elemBo && !refs.includes(elemBo)) {
        refs.push(elemBo);
      }
    }
  }

  // Auto-connect to afterElement when requested (default: true for afterElementId)
  const { autoConnect } = args;
  let connectionId: string | undefined;
  if (afterElementId && autoConnect !== false) {
    const afterEl = elementRegistry.get(afterElementId);
    if (afterEl) {
      try {
        const flowId = generateFlowId(elementRegistry, afterEl.businessObject?.name, elementName);
        const conn = modeling.connect(afterEl, createdElement, {
          type: 'bpmn:SequenceFlow',
          id: flowId,
        });
        fixConnectionId(conn, flowId);
        connectionId = conn.id;
      } catch {
        // Auto-connect may fail for some element type combinations — non-fatal
      }
    }
  }

  await syncXml(diagram);

  // ── Boundary event shorthand: set event definition in one call ─────────
  let eventDefinitionApplied: string | undefined;
  const evtDefType = args.eventDefinitionType;
  if (evtDefType && createdElement.businessObject?.$type?.includes('Event')) {
    await handleSetEventDefinition({
      diagramId,
      elementId: createdElement.id,
      eventDefinitionType: evtDefType,
      properties: args.eventDefinitionProperties,
      errorRef: args.errorRef,
      messageRef: args.messageRef,
      signalRef: args.signalRef,
      escalationRef: args.escalationRef,
    });
    eventDefinitionApplied = evtDefType;
    await syncXml(diagram);
  }

  const needsConnection =
    elementType.includes('Event') ||
    elementType.includes('Task') ||
    elementType.includes('Gateway') ||
    elementType.includes('SubProcess') ||
    elementType.includes('CallActivity');
  const hint =
    needsConnection && !connectionId
      ? ' (not connected - use connect_bpmn_elements to create sequence flows)'
      : '';

  // Collect warnings for ignored parameters
  const warnings: string[] = [];
  if (afterElementId && (args.x !== undefined || args.y !== undefined)) {
    warnings.push(
      'x/y coordinates were ignored because afterElementId was provided (element is auto-positioned relative to the reference element).'
    );
  }

  // Duplicate detection: warn if another element with same type+name exists
  if (elementName) {
    const duplicates = getVisibleElements(elementRegistry).filter(
      (el: any) =>
        el.id !== createdElement.id &&
        el.type === elementType &&
        el.businessObject?.name === elementName
    );
    if (duplicates.length > 0) {
      warnings.push(
        `An element with the same type (${elementType}) and name ("${elementName}") already exists: ${duplicates.map((d: any) => d.id).join(', ')}. ` +
          `This may indicate accidental duplication.`
      );
    }
  }

  const result = jsonResult({
    success: true,
    elementId: createdElement.id,
    elementType,
    name: elementName,
    position: { x, y },
    di: {
      x: createdElement.x,
      y: createdElement.y,
      width: createdElement.width || elementSize.width,
      height: createdElement.height || elementSize.height,
    },
    ...(assignToLaneId ? { laneId: assignToLaneId } : {}),
    ...(connectionId ? { connectionId, autoConnected: true } : {}),
    ...(eventDefinitionApplied ? { eventDefinitionType: eventDefinitionApplied } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(hostInfo
      ? {
          attachedTo: hostInfo,
          message: `Added ${elementType} attached to ${hostInfo.hostElementType} '${hostInfo.hostElementName || hostInfo.hostElementId}'${eventDefinitionApplied ? ` with ${eventDefinitionApplied}` : ''}${hint}`,
        }
      : {
          message: `Added ${elementType} to diagram${eventDefinitionApplied ? ` with ${eventDefinitionApplied}` : ''}${hint}`,
        }),
    diagramCounts: buildElementCounts(elementRegistry),
    ...getTypeSpecificHints(elementType),
    ...getNamingHint(elementType, elementName),
  });
  return appendLintFeedback(result, diagram);
}

// Schema extracted to add-element-schema.ts (R1.5) for readability.
export { TOOL_DEFINITION } from './add-element-schema';
