/**
 * Handler for validate_bpmn_diagram tool.
 *
 * Includes validation for camunda:topic without camunda:type="external"
 * and exclusive gateways without a default flow.
 *
 * Individual checks are extracted into focused sub-functions so the main
 * handler stays short and each check can be reasoned about independently.
 */

import { type ValidateArgs, type ToolResult } from "../types";
import { requireDiagram, jsonResult, getVisibleElements, validateArgs } from "./helpers";

// ── Types ──────────────────────────────────────────────────────────────────

interface ValidationIssue {
  severity: "error" | "warning" | "info";
  message: string;
  elementId?: string;
}

// ── Individual validation checks ───────────────────────────────────────────

/** Warn if no start or end event is present. */
function checkStartEndEvents(allElements: any[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const startEvents = allElements.filter((el: any) => el.type === "bpmn:StartEvent");
  if (startEvents.length === 0) {
    issues.push({ severity: "warning", message: "No start event found" });
  }
  const endEvents = allElements.filter((el: any) => el.type === "bpmn:EndEvent");
  if (endEvents.length === 0) {
    issues.push({ severity: "warning", message: "No end event found" });
  }
  return issues;
}

/** Warn about elements with no incoming or outgoing flows. */
function checkDisconnected(allElements: any[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const skipTypes = new Set([
    "bpmn:SequenceFlow", "bpmn:MessageFlow", "bpmn:Association",
    "bpmn:TextAnnotation", "bpmn:DataObjectReference",
    "bpmn:DataStoreReference", "bpmn:Participant", "bpmn:Lane",
  ]);

  for (const el of allElements) {
    if (skipTypes.has(el.type)) continue;

    const hasIncoming = el.incoming && el.incoming.length > 0;
    const hasOutgoing = el.outgoing && el.outgoing.length > 0;

    if (el.type === "bpmn:StartEvent" && !hasOutgoing) {
      issues.push({
        severity: "warning",
        message: "Start event has no outgoing flow",
        elementId: el.id,
      });
    } else if (el.type === "bpmn:EndEvent" && !hasIncoming) {
      issues.push({
        severity: "warning",
        message: "End event has no incoming flow",
        elementId: el.id,
      });
    } else if (
      el.type !== "bpmn:StartEvent" &&
      el.type !== "bpmn:EndEvent" &&
      el.type !== "bpmn:BoundaryEvent" &&
      !hasIncoming && !hasOutgoing
    ) {
      issues.push({
        severity: "warning",
        message: "Element is disconnected (no incoming or outgoing flows)",
        elementId: el.id,
      });
    }
  }
  return issues;
}

/** Flag tasks that have no name set. */
function checkUnnamedTasks(allElements: any[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tasks = allElements.filter(
    (el: any) =>
      el.type.includes("Task") ||
      el.type === "bpmn:SubProcess" ||
      el.type === "bpmn:CallActivity",
  );
  for (const task of tasks) {
    if (!task.businessObject?.name) {
      issues.push({
        severity: "info",
        message: `${task.type} is unnamed`,
        elementId: task.id,
      });
    }
  }
  return issues;
}

/** Warn about gateways with fewer than 2 outgoing flows and missing default. */
function checkGatewayFlows(allElements: any[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const gateways = allElements.filter((el: any) => el.type.includes("Gateway"));

  for (const gw of gateways) {
    const outgoing = gw.outgoing?.length || 0;
    if (outgoing < 2) {
      issues.push({
        severity: "warning",
        message: `Gateway has fewer than 2 outgoing flows (${outgoing})`,
        elementId: gw.id,
      });
    }
  }

  // Exclusive/inclusive gateways without a default flow
  const exclusiveInclusive = allElements.filter(
    (el: any) =>
      el.type === "bpmn:ExclusiveGateway" || el.type === "bpmn:InclusiveGateway",
  );
  for (const gw of exclusiveInclusive) {
    const outgoing = gw.outgoing || [];
    if (outgoing.length < 2) continue;

    const hasConditions = outgoing.some(
      (flow: any) => flow.businessObject?.conditionExpression,
    );
    const hasDefault = gw.businessObject?.default != null;

    if (hasConditions && !hasDefault) {
      issues.push({
        severity: "warning",
        message: "Exclusive/inclusive gateway has conditional flows but no default flow. The engine will throw an error at runtime if no condition matches.",
        elementId: gw.id,
      });
    }
  }
  return issues;
}

/** Warn about camunda:topic set without camunda:type="external". */
function checkCamundaTopic(allElements: any[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const serviceTasks = allElements.filter((el: any) => el.type === "bpmn:ServiceTask");

  for (const st of serviceTasks) {
    const bo = st.businessObject;
    const topic = bo.topic || bo.$attrs?.["camunda:topic"];
    const type = bo.type || bo.$attrs?.["camunda:type"];
    if (topic && type !== "external") {
      issues.push({
        severity: "warning",
        message: `Service task has camunda:topic="${topic}" but camunda:type is not "external". The engine will ignore the topic without camunda:type="external".`,
        elementId: st.id,
      });
    }
  }
  return issues;
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleValidate(
  args: ValidateArgs,
): Promise<ToolResult> {
  validateArgs(args, ["diagramId"]);
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get("elementRegistry");
  const allElements = getVisibleElements(elementRegistry);

  const issues: ValidationIssue[] = [
    ...checkStartEndEvents(allElements),
    ...checkDisconnected(allElements),
    ...checkUnnamedTasks(allElements),
    ...checkGatewayFlows(allElements),
    ...checkCamundaTopic(allElements),
  ];

  return jsonResult({
    success: true,
    valid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
    issueCount: issues.length,
  });
}

export const TOOL_DEFINITION = {
  name: "validate_bpmn_diagram",
  description:
    "Validate a BPMN diagram for common issues: disconnected elements, missing start/end events, unnamed tasks, etc.",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: { type: "string", description: "The diagram ID" },
    },
    required: ["diagramId"],
  },
} as const;
