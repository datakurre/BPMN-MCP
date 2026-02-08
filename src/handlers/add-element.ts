/**
 * Handler for add_bpmn_element tool.
 */

import { type AddElementArgs, type ToolResult } from "../types";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { requireDiagram, requireElement, jsonResult, syncXml, generateDescriptiveId, getVisibleElements, validateArgs } from "./helpers";
import { STANDARD_BPMN_GAP, getElementSize } from "../constants";

// ── Sub-function: shift downstream elements ────────────────────────────────

/**
 * Shift all non-flow elements at or to the right of `fromX` by `shiftAmount`,
 * excluding `excludeId`.  This prevents overlap when inserting a new element.
 */
function shiftDownstreamElements(
  elementRegistry: any,
  modeling: any,
  fromX: number,
  shiftAmount: number,
  excludeId: string,
): void {
  const allElements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes("SequenceFlow") &&
      !el.type.includes("MessageFlow") &&
      !el.type.includes("Association") &&
      el.id !== excludeId,
  );
  const toShift = allElements.filter((el: any) => el.x >= fromX);
  for (const el of toShift) {
    modeling.moveElements([el], { x: shiftAmount, y: 0 });
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleAddElement(
  args: AddElementArgs,
): Promise<ToolResult> {
  validateArgs(args, ["diagramId", "elementType"]);
  const { diagramId, elementType, name: elementName, hostElementId, afterElementId } = args;
  let { x = 100, y = 100 } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get("modeling");
  const elementFactory = diagram.modeler.get("elementFactory");
  const elementRegistry = diagram.modeler.get("elementRegistry");

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
        afterElementId,
      );
    }
  }

  // Generate a descriptive ID when a name is given
  const descriptiveId = generateDescriptiveId(elementRegistry, elementType, elementName);
  const shapeOpts: Record<string, any> = { type: elementType };
  if (descriptiveId) shapeOpts.id = descriptiveId;

  const shape = elementFactory.createShape(shapeOpts);
  let createdElement: any;

  if (elementType === "bpmn:BoundaryEvent" && hostElementId) {
    // Boundary events must be attached to a host
    const host = requireElement(elementRegistry, hostElementId);
    createdElement = modeling.createShape(shape, { x, y }, host, {
      attach: true,
    });
  } else if (elementType === "bpmn:BoundaryEvent" && !hostElementId) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "BoundaryEvent requires hostElementId to specify the element to attach to",
    );
  } else if (elementType === "bpmn:Participant") {
    // Participants create a collaboration; add via createParticipantBandShape or special handling
    const canvas = diagram.modeler.get("canvas");
    const rootElement = canvas.getRootElement();
    createdElement = modeling.createShape(shape, { x, y }, rootElement);
  } else {
    // Regular element — add to process (or first participant)
    const process = elementRegistry.filter(
      (el: any) => el.type === "bpmn:Process" || el.type === "bpmn:Participant",
    )[0];
    if (!process) {
      throw new McpError(
        ErrorCode.InternalError,
        "No bpmn:Process found in diagram",
      );
    }
    createdElement = modeling.createShape(shape, { x, y }, process);
  }

  if (elementName) {
    modeling.updateProperties(createdElement, { name: elementName });
  }

  await syncXml(diagram);

  const needsConnection =
    elementType.includes("Event") ||
    elementType.includes("Task") ||
    elementType.includes("Gateway") ||
    elementType.includes("SubProcess") ||
    elementType.includes("CallActivity");
  const hint = needsConnection
    ? " (not connected - use connect_bpmn_elements to create sequence flows)"
    : "";

  return jsonResult({
    success: true,
    elementId: createdElement.id,
    elementType,
    name: elementName,
    position: { x, y },
    message: `Added ${elementType} to diagram${hint}`,
  });
}

export const TOOL_DEFINITION = {
  name: "add_bpmn_element",
  description:
    "Add an element (task, gateway, event, etc.) to a BPMN diagram. Supports boundary events via hostElementId and auto-positioning via afterElementId. When afterElementId is used, downstream elements are automatically shifted right to prevent overlap. Generates descriptive element IDs when a name is provided (e.g. UserTask_EnterName, Gateway_HasSurname).",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: {
        type: "string",
        description: "The diagram ID returned from create_bpmn_diagram",
      },
      elementType: {
        type: "string",
        enum: [
          "bpmn:StartEvent",
          "bpmn:EndEvent",
          "bpmn:Task",
          "bpmn:UserTask",
          "bpmn:ServiceTask",
          "bpmn:ScriptTask",
          "bpmn:ManualTask",
          "bpmn:BusinessRuleTask",
          "bpmn:SendTask",
          "bpmn:ReceiveTask",
          "bpmn:CallActivity",
          "bpmn:ExclusiveGateway",
          "bpmn:ParallelGateway",
          "bpmn:InclusiveGateway",
          "bpmn:EventBasedGateway",
          "bpmn:IntermediateCatchEvent",
          "bpmn:IntermediateThrowEvent",
          "bpmn:BoundaryEvent",
          "bpmn:SubProcess",
          "bpmn:TextAnnotation",
          "bpmn:DataObjectReference",
          "bpmn:DataStoreReference",
          "bpmn:Participant",
          "bpmn:Lane",
        ],
        description: "The type of BPMN element to add",
      },
      name: {
        type: "string",
        description: "The name/label for the element",
      },
      x: {
        type: "number",
        description: "X coordinate for the element (default: 100)",
      },
      y: {
        type: "number",
        description: "Y coordinate for the element (default: 100)",
      },
      hostElementId: {
        type: "string",
        description:
          "For boundary events: the ID of the host element (task/subprocess) to attach to",
      },
      afterElementId: {
        type: "string",
        description:
          "Place the new element to the right of this element (auto-positions x/y). Overrides explicit x/y.",
      },
    },
    required: ["diagramId", "elementType"],
  },
} as const;
