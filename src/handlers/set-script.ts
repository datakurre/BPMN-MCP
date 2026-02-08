/**
 * Handler for set_bpmn_script tool.
 *
 * Sets inline script content on a ScriptTask element, including
 * the script body, format (language), and optional result variable.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';

export interface SetScriptArgs {
  diagramId: string;
  elementId: string;
  scriptFormat: string;
  script: string;
  resultVariable?: string;
}

export async function handleSetScript(args: SetScriptArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId', 'scriptFormat', 'script']);
  const { diagramId, elementId, scriptFormat, script, resultVariable } = args;
  const diagram = requireDiagram(diagramId);

  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;

  if (!bo.$type.includes('ScriptTask')) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Element ${elementId} is not a ScriptTask (type: ${bo.$type})`
    );
  }

  // Set the script properties directly on the business object
  const props: Record<string, any> = {
    scriptFormat,
    'camunda:resultVariable': resultVariable || undefined,
  };

  modeling.updateProperties(element, props);

  // Set the script body — bpmn-js stores this as the `script` property
  // on the business object (the element body in XML)
  bo.script = script;

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    scriptFormat,
    scriptLength: script.length,
    resultVariable: resultVariable || undefined,
    message: `Set inline ${scriptFormat} script on ${elementId} (${script.length} chars)`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_script',
  description:
    'Set inline script content on a ScriptTask element. Supports any script language (groovy, javascript, python, etc.) and an optional result variable for Camunda 7.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the ScriptTask element',
      },
      scriptFormat: {
        type: 'string',
        description: "The scripting language (e.g. 'groovy', 'javascript', 'python', 'juel')",
      },
      script: {
        type: 'string',
        description: 'The inline script body',
      },
      resultVariable: {
        type: 'string',
        description:
          'Camunda 7: variable name to store the script result in (camunda:resultVariable)',
      },
    },
    required: ['diagramId', 'elementId', 'scriptFormat', 'script'],
  },
} as const;
