/**
 * Backward-compatibility shim for resize_bpmn_element.
 *
 * Resizing is now handled by the merged move_bpmn_element tool.
 * This module delegates to handleMoveElement with width/height params.
 */

import { type ToolResult } from '../types';
import { handleMoveElement } from './move-element';

export interface ResizeElementArgs {
  diagramId: string;
  elementId: string;
  width: number;
  height: number;
}

export async function handleResizeElement(args: ResizeElementArgs): Promise<ToolResult> {
  return handleMoveElement(args as any);
}
