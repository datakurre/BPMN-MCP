/**
 * Handler for export_bpmn_subprocess tool.
 *
 * Exports a single subprocess or participant as a standalone BPMN diagram.
 */

import { type ToolResult } from '../types';
import { requireDiagram, requireElement, validateArgs } from './helpers';
import { createModelerFromXml } from '../diagram-manager';

export interface ExportSubprocessArgs {
  diagramId: string;
  elementId: string;
  format?: 'xml' | 'svg';
}

export async function handleExportSubprocess(args: ExportSubprocessArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, format = 'xml' } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const element = requireElement(elementRegistry, elementId);

  const elType = element.type || element.businessObject?.$type || '';
  if (!elType.includes('SubProcess') && !elType.includes('Participant')) {
    return {
      content: [
        {
          type: 'text',
          text: `Element ${elementId} is not a SubProcess or Participant (type: ${elType}). Only these types can be exported as standalone diagrams.`,
        },
      ],
    };
  }

  // Build a minimal BPMN XML containing only the subprocess contents
  const bo = element.businessObject;
  const moddle = diagram.modeler.get('moddle');

  // Get the process to export
  let processBO: any;
  if (elType.includes('Participant')) {
    processBO = bo.processRef;
  } else {
    // SubProcess — wrap it in a process
    processBO = bo;
  }

  if (!processBO) {
    return {
      content: [
        {
          type: 'text',
          text: `Could not extract process from element ${elementId}.`,
        },
      ],
    };
  }

  // Check subprocess has flow elements
  const flowElements = processBO.flowElements || [];
  if (flowElements.length === 0 && !elType.includes('Participant')) {
    return {
      content: [
        {
          type: 'text',
          text: `SubProcess ${elementId} has no flow elements to export.`,
        },
      ],
    };
  }

  // Export the full diagram XML as fallback
  const { xml: fullXml } = await diagram.modeler.saveXML({ format: true });

  return exportSubprocessContent({
    moddle,
    processBO,
    elementId,
    format,
    fullXml: fullXml || '',
  });
}

async function exportSubprocessContent(opts: {
  moddle: any;
  processBO: any;
  elementId: string;
  format: string;
  fullXml: string;
}): Promise<ToolResult> {
  const { moddle, processBO, elementId, format, fullXml } = opts;
  try {
    const newProcess = moddle.create('bpmn:Process', {
      id: `Process_${elementId}`,
      isExecutable: true,
      flowElements: [...(processBO.flowElements || [])],
    });

    const exportDefs = moddle.create('bpmn:Definitions', {
      id: 'Definitions_export',
      targetNamespace: 'http://bpmn.io/schema/bpmn',
      rootElements: [newProcess],
    });
    newProcess.$parent = exportDefs;

    const { xml: exportXml } = await moddle.toXML(exportDefs, { format: true });

    if (format === 'svg') {
      try {
        const tempModeler = await createModelerFromXml(exportXml);
        const { svg } = await tempModeler.saveSVG();
        return { content: [{ type: 'text', text: svg || '' }] };
      } catch {
        return {
          content: [
            { type: 'text', text: exportXml },
            { type: 'text', text: '\n⚠ SVG export of subprocess failed; returning XML instead.' },
          ],
        };
      }
    }

    return { content: [{ type: 'text', text: exportXml }] };
  } catch {
    return {
      content: [
        { type: 'text', text: fullXml },
        {
          type: 'text',
          text: `\n⚠ Partial export fallback: full diagram XML returned for ${elementId}.`,
        },
      ],
    };
  }
}

export const TOOL_DEFINITION = {
  name: 'export_bpmn_subprocess',
  description:
    'Export a single subprocess or participant as a standalone BPMN diagram. Useful for modular process documentation.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the subprocess or participant to export',
      },
      format: {
        type: 'string',
        enum: ['xml', 'svg'],
        description: "Export format (default: 'xml')",
      },
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
