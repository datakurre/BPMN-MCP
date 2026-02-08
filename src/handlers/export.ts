/**
 * Unified handler for export_bpmn tool (XML and SVG).
 *
 * Merges the former export_bpmn_xml and export_bpmn_svg tools into a
 * single tool with a required `format` parameter.
 */

import { type ToolResult } from '../types';
import { requireDiagram, buildConnectivityWarnings, validateArgs } from './helpers';

export interface ExportBpmnArgs {
  diagramId: string;
  format: 'xml' | 'svg';
}

export async function handleExportBpmn(args: ExportBpmnArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'format']);
  const { diagramId, format } = args;
  const diagram = requireDiagram(diagramId);

  let output: string;
  if (format === 'svg') {
    const { svg } = await diagram.modeler.saveSVG();
    output = svg || '';
  } else {
    const { xml } = await diagram.modeler.saveXML({ format: true });
    output = xml || '';
  }

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const warnings = buildConnectivityWarnings(elementRegistry);

  const content: ToolResult['content'] = [{ type: 'text', text: output }];
  if (warnings.length > 0) {
    content.push({ type: 'text', text: '\n' + warnings.join('\n') });
  }
  return { content };
}

export const TOOL_DEFINITION = {
  name: 'export_bpmn',
  description: 'Export a BPMN diagram as XML or SVG',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      format: {
        type: 'string',
        enum: ['xml', 'svg'],
        description: "The export format: 'xml' for BPMN XML, 'svg' for SVG image",
      },
    },
    required: ['diagramId', 'format'],
  },
} as const;
