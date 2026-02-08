/**
 * Handler for import_bpmn_xml tool.
 */

import { type ImportXmlArgs, type ToolResult } from '../types';
import { storeDiagram, generateDiagramId, createModelerFromXml } from '../diagram-manager';
import { jsonResult } from './helpers';
import { appendLintFeedback } from '../linter';

export async function handleImportXml(args: ImportXmlArgs): Promise<ToolResult> {
  const { xml } = args;
  const diagramId = generateDiagramId();
  const modeler = await createModelerFromXml(xml);

  const diagram = { modeler, xml };
  storeDiagram(diagramId, diagram);

  const result = jsonResult({
    success: true,
    diagramId,
    message: `Imported BPMN diagram with ID: ${diagramId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'import_bpmn_xml',
  description: 'Import an existing BPMN XML diagram',
  inputSchema: {
    type: 'object',
    properties: {
      xml: { type: 'string', description: 'The BPMN XML to import' },
    },
    required: ['xml'],
  },
} as const;
