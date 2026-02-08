/**
 * Handler for distribute_bpmn_elements tool.
 *
 * Uses edge-to-edge distribution (not center-to-center) so visual gaps
 * remain consistent regardless of element size.  An optional `gap`
 * parameter lets the caller specify exact edge-to-edge spacing.
 */

import { type DistributeElementsArgs, type ToolResult } from "../types";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from "./helpers";

// ── Sub-functions ──────────────────────────────────────────────────────────

type Axis = "x" | "y";
type Dim = "width" | "height";

/** Distribute elements with a fixed gap between edges. */
function distributeFixedGap(
  sorted: any[],
  gap: number,
  axis: Axis,
  dim: Dim,
  modeling: any,
): void {
  let current = sorted[0][axis] + (sorted[0][dim] || 0) + gap;
  for (let i = 1; i < sorted.length; i++) {
    const el = sorted[i];
    const delta = current - el[axis];
    if (Math.abs(delta) > 0.5) {
      const move = axis === "x" ? { x: delta, y: 0 } : { x: 0, y: delta };
      modeling.moveElements([el], move);
    }
    current += (el[dim] || 0) + gap;
  }
}

/** Distribute elements evenly within existing span (edge-to-edge). */
function distributeEven(
  sorted: any[],
  axis: Axis,
  dim: Dim,
  modeling: any,
): void {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSpan = last[axis] + (last[dim] || 0) - first[axis];
  const totalSize = sorted.reduce(
    (sum: number, el: any) => sum + (el[dim] || 0),
    0,
  );
  const computedGap = (totalSpan - totalSize) / (sorted.length - 1);

  let current = first[axis] + (first[dim] || 0) + computedGap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const el = sorted[i];
    const delta = current - el[axis];
    if (Math.abs(delta) > 0.5) {
      const move = axis === "x" ? { x: delta, y: 0 } : { x: 0, y: delta };
      modeling.moveElements([el], move);
    }
    current += (el[dim] || 0) + computedGap;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleDistributeElements(
  args: DistributeElementsArgs,
): Promise<ToolResult> {
  validateArgs(args, ["diagramId", "elementIds", "orientation"]);
  const { diagramId, elementIds, orientation, gap } = args;
  const diagram = requireDiagram(diagramId);

  if (elementIds.length < 3) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Distribution requires at least 3 elements",
    );
  }

  const elementRegistry = diagram.modeler.get("elementRegistry");
  const modeling = diagram.modeler.get("modeling");
  const elements = elementIds.map((id) => requireElement(elementRegistry, id));

  const axis: Axis = orientation === "horizontal" ? "x" : "y";
  const dim: Dim = orientation === "horizontal" ? "width" : "height";
  const sorted = [...elements].sort((a: any, b: any) => a[axis] - b[axis]);

  if (gap !== undefined) {
    distributeFixedGap(sorted, gap, axis, dim, modeling);
  } else {
    distributeEven(sorted, axis, dim, modeling);
  }

  await syncXml(diagram);

  return jsonResult({
    success: true,
    orientation,
    distributedCount: elements.length,
    gap: gap ?? "auto",
    message: `Distributed ${elements.length} elements ${orientation}ly${gap !== undefined ? ` with ${gap}px gap` : ""}`,
  });
}

export const TOOL_DEFINITION = {
  name: "distribute_bpmn_elements",
  description:
    "Evenly distribute selected elements horizontally or vertically using edge-to-edge spacing. Requires at least 3 elements. Without a gap parameter, evenly distributes within the existing span. With gap, uses that exact pixel spacing between element edges (recommended: 50). Tip: for simple cases, align_bpmn_elements with compact=true may be sufficient.",
  inputSchema: {
    type: "object",
    properties: {
      diagramId: { type: "string", description: "The diagram ID" },
      elementIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of element IDs to distribute",
      },
      orientation: {
        type: "string",
        enum: ["horizontal", "vertical"],
        description: "Distribution direction",
      },
      gap: {
        type: "number",
        description:
          "Optional fixed edge-to-edge gap in pixels between elements. Standard BPMN spacing is ~50px. When omitted, elements are evenly distributed within their current span.",
      },
    },
    required: ["diagramId", "elementIds", "orientation"],
  },
} as const;
