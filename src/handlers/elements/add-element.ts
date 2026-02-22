/**
 * Handler for add_bpmn_element tool.
 */
// @mutating

import { type ToolResult } from '../../types';
import {
  requireDiagram,
  requireElement,
  syncXml,
  generateDescriptiveId,
  validateArgs,
  createBusinessObject,
  getVisibleElements,
  getService,
} from '../helpers';
import { getElementSize } from '../../constants';
import { appendLintFeedback } from '../../linter';
import { handleInsertElement } from './insert-element';
import { handleLayoutDiagram } from '../layout/layout-diagram';
import { handleDuplicateElement } from './duplicate-element';
import { snapToLane, createAndPlaceElement } from './add-element-helpers';
import { handleAutoPlaceAdd, assignToLaneFlowNodeRef } from './add-element-autoplace';
import {
  applyEventDefinitionShorthand,
  collectAddElementWarnings,
  buildAddElementResult,
} from './add-element-response';
import { validateElementType, ALLOWED_ELEMENT_TYPES } from '../element-type-validation';
import { illegalCombinationError, typeMismatchError, duplicateError } from '../../errors';

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
  /** Place the element inside a specific parent container (SubProcess or Participant). Child elements are nested in the parent's BPMN structure. */
  parentId?: string;
  /** When true, reject creation if another element with the same type and name already exists. Default: false. */
  ensureUnique?: boolean;
  /**
   * Clarify positioning intent:
   * - 'auto': default placement with collision avoidance (default)
   * - 'after': position after afterElementId (requires afterElementId)
   * - 'absolute': use exact x/y coordinates, no collision avoidance
   * - 'insert': insert into existing flow (requires flowId)
   */
  placementStrategy?: 'auto' | 'after' | 'absolute' | 'insert';
  /**
   * Control collision avoidance behavior:
   * - 'shift': shift right until no overlap (default for 'auto')
   * - 'none': no collision avoidance (elements may overlap)
   */
  collisionPolicy?: 'shift' | 'none';
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
  /** Duplicate an existing element: copies its type, name, and camunda properties. */
  copyFrom?: string;
  /** Offset for copyFrom duplication (default: 50). */
  copyOffsetX?: number;
  /** Offset for copyFrom duplication (default: 50). */
  copyOffsetY?: number;
  /**
   * When true, run layout_bpmn_diagram automatically after adding the element.
   * Useful after the final element in an incremental build sequence.
   * Default: false.
   */
  autoLayout?: boolean;
}

// ── Main handler ───────────────────────────────────────────────────────────

// eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity
export async function handleAddElement(args: AddElementArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementType']);
  validateElementType(args.elementType, ALLOWED_ELEMENT_TYPES);

  // ── copyFrom: delegate to duplicate handler ────────────────────────────
  if (args.copyFrom) {
    return handleDuplicateElement({
      diagramId: args.diagramId,
      elementId: args.copyFrom,
      offsetX: args.copyOffsetX,
      offsetY: args.copyOffsetY,
    });
  }

  // ── Validate incompatible argument combinations ────────────────────────
  if (args.elementType === 'bpmn:BoundaryEvent' && !args.hostElementId) {
    throw illegalCombinationError('BoundaryEvent requires hostElementId.', [
      'elementType',
      'hostElementId',
    ]);
  }
  if (args.elementType === 'bpmn:BoundaryEvent' && args.afterElementId) {
    throw illegalCombinationError(
      'BoundaryEvent cannot use afterElementId — use hostElementId instead.',
      ['elementType', 'afterElementId']
    );
  }

  if (args.flowId && args.afterElementId) {
    throw illegalCombinationError('Cannot use both flowId and afterElementId. Choose one.', [
      'flowId',
      'afterElementId',
    ]);
  }

  if (args.eventDefinitionType && !args.elementType.includes('Event')) {
    throw typeMismatchError(args.elementType, args.elementType, [
      'bpmn:StartEvent',
      'bpmn:EndEvent',
      'bpmn:IntermediateCatchEvent',
      'bpmn:IntermediateThrowEvent',
      'bpmn:BoundaryEvent',
    ]);
  }

  // Validate placementStrategy consistency
  if (args.placementStrategy === 'after' && !args.afterElementId) {
    throw illegalCombinationError('placementStrategy "after" requires afterElementId to be set.', [
      'placementStrategy',
      'afterElementId',
    ]);
  }
  if (args.placementStrategy === 'insert' && !args.flowId) {
    throw illegalCombinationError('placementStrategy "insert" requires flowId to be set.', [
      'placementStrategy',
      'flowId',
    ]);
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
    parentId,
  } = args;
  // SubProcess defaults to expanded (true) unless explicitly set to false
  const isExpanded = elementType === 'bpmn:SubProcess' ? args.isExpanded !== false : undefined;
  let { x = 100 } = args;
  let { y = 100 } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = getService(diagram.modeler, 'modeling');
  const elementRegistry = getService(diagram.modeler, 'elementRegistry');

  // ensureUnique: reject creation if another element with same type+name exists
  if (args.ensureUnique && elementName) {
    const duplicates = getVisibleElements(elementRegistry).filter(
      (el: any) => el.type === elementType && el.businessObject?.name === elementName
    );
    if (duplicates.length > 0) {
      throw duplicateError(
        `ensureUnique: an element with type ${elementType} and name "${elementName}" already exists: ${duplicates.map((d: any) => d.id).join(', ')}. ` +
          `Set ensureUnique to false to allow duplicates.`,
        duplicates.map((d: any) => d.id)
      );
    }
  }

  // Auto-position after another element using bpmn-js AutoPlace
  // Note: AutoPlace doesn't support parentId (placing inside a subprocess),
  // so we fall through to the standard path when parentId is specified.
  if (afterElementId && !hostElementId && !parentId) {
    return handleAutoPlaceAdd(
      args,
      diagram,
      modeling,
      elementRegistry,
      afterElementId,
      elementType,
      elementName,
      hostElementId,
      isExpanded
    );
  }

  // ── Standard path: boundary events, absolute positioning, default placement ──

  // When afterElementId is used in the standard path (e.g. with parentId),
  // position the new element to the right of the after element
  if (afterElementId && args.x === undefined && args.y === undefined) {
    const afterEl = requireElement(elementRegistry, afterElementId);
    const GAP = 50;
    x = afterEl.x + (afterEl.width || 100) + GAP;
    y = afterEl.y + (afterEl.height || 80) / 2;
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
      throw typeMismatchError(args.laneId, targetLane.type, ['bpmn:Lane']);
    }
    // Center the element vertically in the lane
    const laneCy = targetLane.y + (targetLane.height || 0) / 2;
    y = laneCy;
    assignToLaneId = args.laneId;
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
    parentId,
    isExpanded,
  });

  if (elementName) {
    modeling.updateProperties(createdElement, { name: elementName });
  }

  // bpmn:Group at negative coordinates: clamp to (0, 0)
  if (elementType === 'bpmn:Group' && (createdElement.x < 0 || createdElement.y < 0)) {
    const clampDx = createdElement.x < 0 ? -createdElement.x : 0;
    const clampDy = createdElement.y < 0 ? -createdElement.y : 0;
    if (clampDx > 0 || clampDy > 0) {
      modeling.moveElements([createdElement], { x: clampDx, y: clampDy });
    }
  }

  // Register element in lane's flowNodeRef list if laneId was specified
  if (assignToLaneId) {
    assignToLaneFlowNodeRef(elementRegistry, assignToLaneId, createdElement);
  }

  // Auto-connect when afterElementId is set in the standard path
  // (this handles the parentId + afterElementId case where AutoPlace isn't used)
  let connectionId: string | undefined;
  const connectionsCreated: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
  }> = [];
  if (afterElementId && args.autoConnect !== false) {
    const afterEl = elementRegistry.get(afterElementId);
    if (afterEl) {
      try {
        const conn = modeling.connect(afterEl, createdElement, { type: 'bpmn:SequenceFlow' });
        connectionId = conn.id;
        connectionsCreated.push({
          id: conn.id,
          sourceId: afterElementId,
          targetId: createdElement.id,
          type: 'bpmn:SequenceFlow',
        });
      } catch {
        // Auto-connect may fail for some element type combinations — non-fatal
      }
    }
  }

  await syncXml(diagram);

  // ── Boundary event shorthand: set event definition in one call ─────────
  const eventDefinitionApplied = await applyEventDefinitionShorthand(
    diagramId,
    createdElement,
    diagram,
    args
  );

  // Collect warnings and build result
  const warnings = collectAddElementWarnings({
    afterElementId,
    argsX: args.x,
    argsY: args.y,
    assignToLaneId,
    hostElementId,
    elementType,
    elementName,
    createdElementId: createdElement.id,
    elementRegistry,
  });

  if (args.autoLayout) {
    await handleLayoutDiagram({ diagramId });
  }

  const result = buildAddElementResult({
    createdElement,
    elementType,
    elementName,
    x,
    y,
    elementSize,
    assignToLaneId,
    connectionId,
    connectionsCreated,
    eventDefinitionApplied,
    warnings,
    hostInfo,
    elementRegistry,
  });
  return appendLintFeedback(result, diagram);
}

// Schema extracted to add-element-schema.ts (R1.5) for readability.
export { TOOL_DEFINITION } from './add-element-schema';
