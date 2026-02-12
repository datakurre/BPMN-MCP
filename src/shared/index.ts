/**
 * Shared types and interfaces used across module boundaries.
 *
 * This barrel provides a single import point for cross-cutting types:
 *
 *   import { type DiagramState, type ToolResult } from '../shared';
 *   import { type BpmnElement, getService } from '../shared';
 *   import { type FlatLintIssue } from '../shared';
 *
 * The canonical definitions remain in their original files for backwards
 * compatibility.  New code should prefer importing from `../shared`.
 */

// Core diagram state and tool result types
export { type BpmnModeler, type DiagramState, type ToolResult } from '../types';

// bpmn-js service and element type declarations
export {
  type BusinessObject,
  type EventDefinition,
  type ExtensionElements,
  type ExtensionElement,
  type BpmnElement,
  type Modeling,
  type ElementFactory,
  type ElementRegistry,
  type Canvas,
  type Moddle,
  type BpmnFactory,
  type CommandStack,
  type BpmnReplace,
  type ServiceMap,
  getService,
} from '../bpmn-types';

// bpmnlint type declarations
export {
  type LintReport,
  type LintResults,
  type LintConfig,
  type FlatLintIssue,
} from '../bpmnlint-types';
