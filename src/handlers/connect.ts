/**
 * Handler for connect_bpmn_elements tool.
 */

import { type ConnectArgs, type ToolResult } from "../types";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { requireDiagram, jsonResult, syncXml, generateFlowId, validateArgs } from "./helpers";
import { appendLintFeedback } from "../linter";

export async function handleConnect(args: ConnectArgs): Promise<ToolResult> {
  validateArgs(args, ["diagramId", "sourceElementId", "targetElementId"]);
  const {
    diagramId,
    sourceElementId,
    targetElementId,
    label,
    connectionType = "bpmn:SequenceFlow",
    conditionExpression,
    isDefault,
  } = args;
  const diagram = requireDiagram(diagramId);

  const modeling = diagram.modeler.get("modeling");
  const elementRegistry = diagram.modeler.get("elementRegistry");

  const source = elementRegistry.get(sourceElementId);
  const target = elementRegistry.get(targetElementId);
  if (!source) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Source element not found: ${sourceElementId}`,
    );
  }
  if (!target) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Target element not found: ${targetElementId}`,
    );
  }

  // Generate a descriptive flow ID
  const flowId = generateFlowId(
    elementRegistry,
    source.businessObject?.name,
    target.businessObject?.name,
    label,
  );
  const connectOpts: Record<string, any> = { type: connectionType };
  if (flowId) connectOpts.id = flowId;

  const connection = modeling.connect(source, target, connectOpts);

  if (label) {
    modeling.updateProperties(connection, { name: label });
  }

  // Set condition expression for gateway branches
  if (conditionExpression && connectionType === "bpmn:SequenceFlow") {
    const moddle = diagram.modeler.get("moddle");
    const condExpr = moddle.create("bpmn:FormalExpression", {
      body: conditionExpression,
    });
    modeling.updateProperties(connection, {
      conditionExpression: condExpr,
    });
  }

  // Set as default flow on the source gateway if requested
  if (isDefault && connectionType === "bpmn:SequenceFlow") {
    const sourceType = source.type || source.businessObject?.$type || "";
    if (
      sourceType.includes("ExclusiveGateway") ||
      sourceType.includes("InclusiveGateway")
    ) {
      // Set directly on the business object to avoid bpmn-js internal issues
      source.businessObject.default = connection.businessObject;
    }
  }

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    connectionId: connection.id,
    connectionType,
    isDefault: isDefault || false,
    message: `Connected ${sourceElementId} to ${targetElementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: "connect_bpmn_elements",
  description:
    "Connect two BPMN elements with a sequence flow, message flow, or association. Supports optional condition expressions for gateway branches. Supports isDefault flag to mark a flow as the gateway's default flow. Generates descriptive flow IDs based on element names or labels.",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: {
        type: "string",
        description: "The diagram ID",
      },
      sourceElementId: {
        type: "string",
        description: "The ID of the source element",
      },
      targetElementId: {
        type: "string",
        description: "The ID of the target element",
      },
      label: {
        type: "string",
        description: "Optional label for the connection",
      },
      connectionType: {
        type: "string",
        enum: [
          "bpmn:SequenceFlow",
          "bpmn:MessageFlow",
          "bpmn:Association",
        ],
        description:
          "Type of connection (default: bpmn:SequenceFlow)",
      },
      conditionExpression: {
        type: "string",
        description:
          "Optional condition expression for sequence flows leaving gateways (e.g. '${approved == true}')",
      },
      isDefault: {
        type: "boolean",
        description:
          "When connecting from an exclusive/inclusive gateway, set this flow as the gateway's default flow (taken when no condition matches).",
      },
    },
    required: ["diagramId", "sourceElementId", "targetElementId"],
  },
} as const;
