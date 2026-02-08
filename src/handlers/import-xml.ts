/**
 * Handler for import_bpmn_xml tool.
 */

import { type ImportXmlArgs, type ToolResult } from "../types";
import {
  storeDiagram,
  generateDiagramId,
  createModelerFromXml,
} from "../diagram-manager";
import { jsonResult } from "./helpers";

export async function handleImportXml(
  args: ImportXmlArgs,
): Promise<ToolResult> {
  const { xml } = args;
  const diagramId = generateDiagramId();
  const modeler = await createModelerFromXml(xml);

  storeDiagram(diagramId, {
    modeler,
    xml,
  });

  return jsonResult({
    success: true,
    diagramId,
    message: `Imported BPMN diagram with ID: ${diagramId}`,
  });
}

export const TOOL_DEFINITION = {
  name: "import_bpmn_xml",
  description: "Import an existing BPMN XML diagram",
  inputSchema: {
    type: "object",
    properties: {
      xml: { type: "string", description: "The BPMN XML to import" },
    },
    required: ["xml"],
  },
} as const;
