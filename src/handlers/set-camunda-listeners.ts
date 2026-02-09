/**
 * Handler for set_bpmn_camunda_listeners tool.
 *
 * Creates camunda:ExecutionListener and camunda:TaskListener extension
 * elements on BPMN elements.  Execution listeners can be attached to any
 * flow node or process; task listeners are specific to UserTasks.
 */

import { type ToolResult } from '../types';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { requireDiagram, requireElement, jsonResult, syncXml, validateArgs } from './helpers';
import { appendLintFeedback } from '../linter';

export interface SetCamundaListenersArgs {
  diagramId: string;
  elementId: string;
  executionListeners?: Array<{
    event: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
  }>;
  taskListeners?: Array<{
    event: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
  }>;
}

function createListenerElement(
  moddle: any,
  type: 'camunda:ExecutionListener' | 'camunda:TaskListener',
  listener: {
    event: string;
    class?: string;
    delegateExpression?: string;
    expression?: string;
    script?: { scriptFormat: string; value: string };
  }
): any {
  const attrs: Record<string, any> = { event: listener.event };

  if (listener.class) {
    attrs['class'] = listener.class;
  } else if (listener.delegateExpression) {
    attrs.delegateExpression = listener.delegateExpression;
  } else if (listener.expression) {
    attrs.expression = listener.expression;
  }

  const el = moddle.create(type, attrs);

  // Inline script support
  if (listener.script) {
    const scriptEl = moddle.create('camunda:Script', {
      scriptFormat: listener.script.scriptFormat,
      value: listener.script.value,
    });
    scriptEl.$parent = el;
    el.script = scriptEl;
  }

  return el;
}

export async function handleSetCamundaListeners(
  args: SetCamundaListenersArgs
): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'elementId']);
  const { diagramId, elementId, executionListeners = [], taskListeners = [] } = args;

  if (executionListeners.length === 0 && taskListeners.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'At least one executionListener or taskListener must be provided'
    );
  }

  const diagram = requireDiagram(diagramId);
  const elementRegistry = diagram.modeler.get('elementRegistry');
  const modeling = diagram.modeler.get('modeling');
  const moddle = diagram.modeler.get('moddle');

  const element = requireElement(elementRegistry, elementId);
  const bo = element.businessObject;
  const elType = element.type || bo.$type || '';

  // Validate: taskListeners only on UserTask
  if (taskListeners.length > 0 && !elType.includes('UserTask')) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Task listeners can only be set on bpmn:UserTask elements, got ${elType}`
    );
  }

  // Ensure extensionElements container exists
  let extensionElements = bo.extensionElements;
  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extensionElements.$parent = bo;
  }

  // Remove existing listeners of the types we're setting
  extensionElements.values = (extensionElements.values || []).filter(
    (v: any) => v.$type !== 'camunda:ExecutionListener' && v.$type !== 'camunda:TaskListener'
  );

  // Create execution listeners
  for (const listener of executionListeners) {
    const el = createListenerElement(moddle, 'camunda:ExecutionListener', listener);
    el.$parent = extensionElements;
    extensionElements.values.push(el);
  }

  // Create task listeners
  for (const listener of taskListeners) {
    const el = createListenerElement(moddle, 'camunda:TaskListener', listener);
    el.$parent = extensionElements;
    extensionElements.values.push(el);
  }

  modeling.updateProperties(element, { extensionElements });

  await syncXml(diagram);

  const result = jsonResult({
    success: true,
    elementId,
    executionListenerCount: executionListeners.length,
    taskListenerCount: taskListeners.length,
    message: `Set ${executionListeners.length} execution listener(s) and ${taskListeners.length} task listener(s) on ${elementId}`,
  });
  return appendLintFeedback(result, diagram);
}

export const TOOL_DEFINITION = {
  name: 'set_bpmn_camunda_listeners',
  description:
    'Set Camunda execution listeners and/or task listeners on a BPMN element. Execution listeners can be attached to any flow node or process. Task listeners are specific to UserTasks. Each listener specifies an event (start, end, take, create, assignment, complete, delete) and an implementation (class, delegateExpression, expression, or inline script).',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      elementId: {
        type: 'string',
        description: 'The ID of the element to add listeners to',
      },
      executionListeners: {
        type: 'array',
        description: 'Execution listeners to set (replaces existing)',
        items: {
          type: 'object',
          properties: {
            event: {
              type: 'string',
              description: "Listener event: 'start', 'end', or 'take' (for sequence flows)",
            },
            class: {
              type: 'string',
              description: 'Fully qualified Java class name implementing ExecutionListener',
            },
            delegateExpression: {
              type: 'string',
              description: "Expression resolving to a listener bean (e.g. '${myListenerBean}')",
            },
            expression: {
              type: 'string',
              description: "UEL expression to evaluate (e.g. '${myBean.notify(execution)}')",
            },
            script: {
              type: 'object',
              description: 'Inline script for the listener',
              properties: {
                scriptFormat: {
                  type: 'string',
                  description: "Script language (e.g. 'groovy', 'javascript')",
                },
                value: { type: 'string', description: 'The script body' },
              },
              required: ['scriptFormat', 'value'],
            },
          },
          required: ['event'],
        },
      },
      taskListeners: {
        type: 'array',
        description: 'Task listeners to set (UserTask only, replaces existing)',
        items: {
          type: 'object',
          properties: {
            event: {
              type: 'string',
              description: "Listener event: 'create', 'assignment', 'complete', or 'delete'",
            },
            class: {
              type: 'string',
              description: 'Fully qualified Java class name implementing TaskListener',
            },
            delegateExpression: {
              type: 'string',
              description: 'Expression resolving to a listener bean',
            },
            expression: {
              type: 'string',
              description: 'UEL expression to evaluate',
            },
            script: {
              type: 'object',
              description: 'Inline script for the listener',
              properties: {
                scriptFormat: {
                  type: 'string',
                  description: "Script language (e.g. 'groovy', 'javascript')",
                },
                value: { type: 'string', description: 'The script body' },
              },
              required: ['scriptFormat', 'value'],
            },
          },
          required: ['event'],
        },
      },
    },
    required: ['diagramId', 'elementId'],
  },
} as const;
