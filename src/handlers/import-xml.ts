/**
 * Handler for import_bpmn_xml tool.
 *
 * Supports an optional `autoLayout` boolean:
 *  - `true`:  always run bpmn-auto-layout after import
 *  - `false`: never run auto-layout (use embedded DI as-is)
 *  - omitted: auto-detect — run layout only if the XML lacks DI coordinates
 */

import { type ImportXmlArgs, type ToolResult } from '../types';
import { storeDiagram, generateDiagramId, createModelerFromXml } from '../diagram-manager';
import { jsonResult } from './helpers';
import { appendLintFeedback } from '../linter';

/** Check whether BPMN XML contains diagram interchange (DI) coordinates. */
function xmlHasDiagramDI(xml: string): boolean {
  return xml.includes('bpmndi:BPMNShape') || xml.includes('bpmndi:BPMNEdge');
}

export async function handleImportXml(args: ImportXmlArgs): Promise<ToolResult> {
  const { xml, autoLayout } = args;
  const diagramId = generateDiagramId();

  // Determine whether to run auto-layout
  const shouldLayout = autoLayout === true || (autoLayout === undefined && !xmlHasDiagramDI(xml));

  let finalXml = xml;
  if (shouldLayout) {
    const { layoutProcess } = await import('bpmn-auto-layout');
    finalXml = await layoutProcess(xml);
  }

  const modeler = await createModelerFromXml(finalXml);

  const diagram = { modeler, xml: finalXml };
  storeDiagram(diagramId, diagram);

  const result = jsonResult({
    success: true,
    diagramId,
    autoLayoutApplied: shouldLayout,
    message: `Imported BPMN diagram with ID: ${diagramId}${shouldLayout ? ' (auto-layout applied)' : ''}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'import_bpmn_xml',
  description:
    'Import an existing BPMN XML diagram. If the XML lacks diagram coordinates (DI), bpmn-auto-layout is run automatically. Use autoLayout to force or skip auto-layout.',
  inputSchema: {
    type: 'object',
    properties: {
      xml: { type: 'string', description: 'The BPMN XML to import' },
      autoLayout: {
        type: 'boolean',
        description:
          'Force (true) or skip (false) auto-layout. When omitted, auto-layout runs only if the XML has no diagram coordinates.',
      },
    },
    required: ['xml'],
  },
} as const;
