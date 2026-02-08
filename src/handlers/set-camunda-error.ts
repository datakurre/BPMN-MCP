/**
 * Handler for set_camunda_error_event_definition tool.
 *
 * Creates camunda:ErrorEventDefinition extension elements on Service Tasks
 * for Camunda 7 External Task error handling. These are distinct from the
 * standard bpmn:ErrorEventDefinition on boundary events.
 */

import { type SetCamundaErrorEventDefinitionArgs, type ToolResult } from "../types";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { requireDiagram, requireElement, jsonResult, syncXml, resolveOrCreateError, validateArgs } from "./helpers";
import { appendLintFeedback } from "../linter";

export async function handleSetCamundaErrorEventDefinition(
  args: SetCamundaErrorEventDefinitionArgs,
): Promise<ToolResult> {
  validateArgs(args, ["diagramId", "elementId", "errorDefinitions"]);
  const { diagramId, elementId, errorDefinitions } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get("elementRegistry");
  const modeling = diagram.modeler.get("modeling");
  const moddle = diagram.modeler.get("moddle");

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Must be a service task
  if (bo.$type !== "bpmn:ServiceTask") {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `set_camunda_error_event_definition is only supported on bpmn:ServiceTask (got ${bo.$type})`,
    );
  }

  // Ensure extensionElements exist
  if (!bo.extensionElements) {
    bo.extensionElements = moddle.create("bpmn:ExtensionElements", {
      values: [],
    });
    bo.extensionElements.$parent = bo;
  }

  // Remove existing camunda:ErrorEventDefinition extension elements
  bo.extensionElements.values = (bo.extensionElements.values || []).filter(
    (ext: any) => ext.$type !== "camunda:ErrorEventDefinition",
  );

  // Resolve definitions for bpmn:Error root elements
  const canvas = diagram.modeler.get("canvas");
  const rootElement = canvas.getRootElement();
  const definitions = rootElement.businessObject.$parent;

  for (const errDef of errorDefinitions) {
    const errorElement = errDef.errorRef
      ? resolveOrCreateError(moddle, definitions, errDef.errorRef)
      : undefined;

    const camundaErrDef = moddle.create("camunda:ErrorEventDefinition", {
      id: errDef.id,
      expression: errDef.expression,
    });
    if (errorElement) {
      camundaErrDef.errorRef = errorElement;
    }
    camundaErrDef.$parent = bo.extensionElements;
    bo.extensionElements.values.push(camundaErrDef);
  }

  // Trigger update through modeling API
  modeling.updateProperties(element, {
    extensionElements: bo.extensionElements,
  });

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    definitionCount: errorDefinitions.length,
    message: `Set ${errorDefinitions.length} camunda:ErrorEventDefinition(s) on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: "set_camunda_error_event_definition",
  description:
    "Set camunda:ErrorEventDefinition extension elements on a Service Task for Camunda 7 External Task error handling. These are distinct from standard bpmn:ErrorEventDefinition on boundary events \u2014 they define error-handling expressions directly on the Service Task with an id, expression, and optional errorRef.",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: { type: "string", description: "The diagram ID" },
      elementId: {
        type: "string",
        description: "The ID of the Service Task element",
      },
      errorDefinitions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique ID for the error event definition",
            },
            expression: {
              type: "string",
              description:
                "Error expression (e.g. '${error.code == \"ERR_001\"}')",
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
                "Reference to a bpmn:Error root element (created if not existing)",
            },
          },
          required: ["id"],
        },
        description: "Array of camunda:ErrorEventDefinition entries",
      },
    },
    required: ["diagramId", "elementId", "errorDefinitions"],
  },
} as const;
