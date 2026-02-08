/**
 * Handler for set_input_output_mapping tool.
 *
 * Accepts `value` on input/output parameters for both static values and
 * expressions (e.g. `${myVar}`).  Does NOT support `source` or
 * `sourceExpression` — those belong to `camunda:In`/`camunda:Out` for call
 * activity variable mapping, not to `camunda:InputParameter`.
 */

import { type SetInputOutputArgs, type ToolResult } from "../types";
import { requireDiagram, requireElement, jsonResult, syncXml, upsertExtensionElement, validateArgs } from "./helpers";

export async function handleSetInputOutput(
  args: SetInputOutputArgs,
): Promise<ToolResult> {
  validateArgs(args, ["diagramId", "elementId"]);
  const { diagramId, elementId, inputParameters = [], outputParameters = [] } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get("elementRegistry");
  const modeling = diagram.modeler.get("modeling");
  const moddle = diagram.modeler.get("moddle");

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  // Build camunda:InputParameter elements
  const inputParams = inputParameters.map((p) => {
    const attrs: Record<string, any> = { name: p.name };
    if (p.value !== undefined) attrs.value = p.value;
    return moddle.create("camunda:InputParameter", attrs);
  });

  // Build camunda:OutputParameter elements
  const outputParams = outputParameters.map((p) => {
    const attrs: Record<string, any> = { name: p.name };
    if (p.value !== undefined) attrs.value = p.value;
    return moddle.create("camunda:OutputParameter", attrs);
  });

  // Build camunda:InputOutput element
  const ioAttrs: Record<string, any> = {};
  if (inputParams.length > 0) ioAttrs.inputParameters = inputParams;
  if (outputParams.length > 0) ioAttrs.outputParameters = outputParams;
  const inputOutput = moddle.create("camunda:InputOutput", ioAttrs);

  upsertExtensionElement(moddle, bo, modeling, element, "camunda:InputOutput", inputOutput);

  await syncXml(diagram);

  return jsonResult({
    success: true,
    elementId,
    inputParameterCount: inputParams.length,
    outputParameterCount: outputParams.length,
    message: `Set input/output mapping on ${elementId}`,
  });
}

export const TOOL_DEFINITION = {
  name: "set_input_output_mapping",
  description:
    "Set Camunda input/output parameter mappings on an element. Creates camunda:InputOutput extension elements with camunda:InputParameter and camunda:OutputParameter children. The 'value' field accepts both static values (e.g. '123') and expressions (e.g. '${myVar}', '${execution.getVariable('name')}').",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: { type: "string", description: "The diagram ID" },
      elementId: {
        type: "string",
        description: "The ID of the element to update",
      },
      inputParameters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Parameter name" },
            value: {
              type: "string",
              description:
                "Static value or expression. Examples: '123', '${myVar}', '${execution.getVariable('orderId')}'.",
            },
          },
          required: ["name"],
        },
        description: "Input parameters to set",
      },
      outputParameters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Parameter name" },
            value: {
              type: "string",
              description:
                "Static value or expression. Examples: 'ok', '${result}'.",
            },
          },
          required: ["name"],
        },
        description: "Output parameters to set",
      },
    },
    required: ["diagramId", "elementId"],
  },
} as const;
