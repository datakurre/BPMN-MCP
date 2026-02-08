/**
 * Handler for layout_diagram tool.
 *
 * Uses bpmn-auto-layout to automatically arrange all elements in a BPMN
 * diagram, producing a clean left-to-right layout.  This is the single
 * canonical layout tool — the former `auto_layout` tool was merged here.
 */

import { type LayoutDiagramArgs, type ToolResult } from '../types';
import { requireDiagram, jsonResult, getVisibleElements } from './helpers';
import { createModelerFromXml } from '../diagram-manager';
import { appendLintFeedback } from '../linter';
import { adjustDiagramLabels, adjustFlowLabels } from './adjust-labels';

export async function handleLayoutDiagram(args: LayoutDiagramArgs): Promise<ToolResult> {
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);

  // Export current XML, run bpmn-auto-layout, then re-import
  const { xml: currentXml } = await diagram.modeler.saveXML({ format: true });
  const { layoutProcess } = await import('bpmn-auto-layout');
  const layoutedXml: string = await layoutProcess(currentXml);

  const newModeler = await createModelerFromXml(layoutedXml);
  diagram.modeler = newModeler;
  diagram.xml = layoutedXml;

  const elementRegistry = diagram.modeler.get('elementRegistry');

  // Count laid-out elements for the response (exclude flows)
  const elements = getVisibleElements(elementRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  );

  // Adjust labels after layout (bpmn-auto-layout doesn't produce label DI)
  const labelsMoved = await adjustDiagramLabels(diagram);
  const flowLabelsMoved = await adjustFlowLabels(diagram);

  const result = jsonResult({
    success: true,
    elementCount: elements.length,
    labelsMoved: labelsMoved + flowLabelsMoved,
    message: `Layout applied to diagram ${diagramId} — ${elements.length} elements arranged`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'layout_diagram',
  description:
    'Automatically arrange all elements in a BPMN diagram using bpmn-auto-layout, producing a clean left-to-right layout. Use this after structural changes (adding gateways, splitting flows) to automatically clean up the layout.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
    },
    required: ['diagramId'],
  },
} as const;
