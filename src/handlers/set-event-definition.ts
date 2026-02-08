/**
 * Handler for set_event_definition tool.
 */

import { type SetEventDefinitionArgs, type ToolResult } from "../types";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { requireDiagram, requireElement, jsonResult, syncXml, resolveOrCreateError, validateArgs } from "./helpers";

export async function handleSetEventDefinition(
  args: SetEventDefinitionArgs,
): Promise<ToolResult> {
  validateArgs(args, ["diagramId", "elementId", "eventDefinitionType"]);
  const { diagramId, elementId, eventDefinitionType, properties: defProps = {}, errorRef } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get("elementRegistry");
  const modeling = diagram.modeler.get("modeling");
  const moddle = diagram.modeler.get("moddle");

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Verify element is an event type
  if (
    !bo.$type.includes("Event")
  ) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Element ${elementId} is not an event (type: ${bo.$type})`,
    );
  }

  // Create the event definition
  const eventDefAttrs: Record<string, any> = {};

  // Handle timer-specific properties
  if (eventDefinitionType === "bpmn:TimerEventDefinition") {
    if (defProps.timeDuration) {
      eventDefAttrs.timeDuration = moddle.create("bpmn:FormalExpression", {
        body: defProps.timeDuration,
      });
    }
    if (defProps.timeDate) {
      eventDefAttrs.timeDate = moddle.create("bpmn:FormalExpression", {
        body: defProps.timeDate,
      });
    }
    if (defProps.timeCycle) {
      eventDefAttrs.timeCycle = moddle.create("bpmn:FormalExpression", {
        body: defProps.timeCycle,
      });
    }
  }

  // Handle error reference
  if (eventDefinitionType === "bpmn:ErrorEventDefinition" && errorRef) {
    const canvas = diagram.modeler.get("canvas");
    const rootElement = canvas.getRootElement();
    const definitions = rootElement.businessObject.$parent;
    eventDefAttrs.errorRef = resolveOrCreateError(moddle, definitions, errorRef);
  }

  const eventDef = moddle.create(eventDefinitionType, eventDefAttrs);

  // Replace existing event definitions
  bo.eventDefinitions = [eventDef];
  eventDef.$parent = bo;

  // Use modeling to trigger proper updates
  modeling.updateProperties(element, {
    eventDefinitions: bo.eventDefinitions,
  });

  await syncXml(diagram);

  return jsonResult({
    success: true,
    elementId,
    eventDefinitionType,
    message: `Set ${eventDefinitionType} on ${elementId}`,
  });
}

export const TOOL_DEFINITION = {
  name: "set_event_definition",
  description:
    "Add or replace an event definition on an event element (e.g. bpmn:ErrorEventDefinition, bpmn:TimerEventDefinition, bpmn:MessageEventDefinition, bpmn:SignalEventDefinition, bpmn:TerminateEventDefinition, bpmn:EscalationEventDefinition). For error events, optionally creates/references a bpmn:Error root element.",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: { type: "string", description: "The diagram ID" },
      elementId: {
        type: "string",
        description: "The ID of the event element",
      },
      eventDefinitionType: {
        type: "string",
        enum: [
          "bpmn:ErrorEventDefinition",
          "bpmn:TimerEventDefinition",
          "bpmn:MessageEventDefinition",
          "bpmn:SignalEventDefinition",
          "bpmn:TerminateEventDefinition",
          "bpmn:EscalationEventDefinition",
        ],
        description: "The type of event definition to add",
      },
      properties: {
        type: "object",
        description:
          "Type-specific properties: for Timer: { timeDuration?, timeDate?, timeCycle? }. For Camunda error on service tasks use set_element_properties with camunda extensions.",
        additionalProperties: true,
      },
      errorRef: {
        type: "object",
        properties: {
          id: { type: "string", description: "Error element ID" },
          name: { type: "string", description: "Error name" },
          errorCode: { type: "string", description: "Error code" },
        },
        required: ["id"],
        description:
          "For ErrorEventDefinition: creates or references a bpmn:Error root element",
      },
    },
    required: ["diagramId", "elementId", "eventDefinitionType"],
  },
} as const;
