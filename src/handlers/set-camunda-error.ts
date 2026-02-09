/**
 * Backward-compatibility shim for set_bpmn_camunda_error.
 *
 * Error definitions are now handled by the merged set_bpmn_camunda_listeners tool.
 * This module delegates to handleSetCamundaListeners with errorDefinitions param.
 */

import { type SetCamundaErrorEventDefinitionArgs, type ToolResult } from '../types';
import { handleSetCamundaListeners } from './set-camunda-listeners';

export async function handleSetCamundaErrorEventDefinition(
  args: SetCamundaErrorEventDefinitionArgs
): Promise<ToolResult> {
  return handleSetCamundaListeners({
    diagramId: args.diagramId,
    elementId: args.elementId,
    errorDefinitions: args.errorDefinitions,
  });
}
