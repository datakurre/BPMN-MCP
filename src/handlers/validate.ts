/**
 * Handler for validate_bpmn_diagram tool.
 *
 * Fully delegates to bpmnlint for all checks — standard BPMN rules,
 * Camunda 7 (Operaton) compat checks via bpmnlint-plugin-camunda-compat,
 * and custom MCP rules via bpmnlint-plugin-bpmn-mcp (registered through
 * the McpPluginResolver in src/linter.ts).
 *
 * Merges the former lint_bpmn_diagram tool — the config override and
 * per-severity counts are now part of this single tool.
 */

import { type ValidateArgs, type ToolResult } from '../types';
import { requireDiagram, jsonResult, validateArgs } from './helpers';
import { lintDiagramFlat, getEffectiveConfig } from '../linter';
import type { FlatLintIssue } from '../bpmnlint-types';

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  elementId?: string;
  rule?: string;
  docUrl?: string;
}

export async function handleValidate(args: ValidateArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId']);
  const { config, lintMinSeverity } = args;
  const diagram = requireDiagram(args.diagramId);

  // Resolve the effective bpmnlint config (user override > .bpmnlintrc > default)
  const effectiveConfig = config ? (config as any) : getEffectiveConfig();

  // Run bpmnlint — the default config extends bpmnlint:recommended,
  // plugin:camunda-compat/camunda-platform-7-24, and plugin:bpmn-mcp/recommended
  let lintIssues: FlatLintIssue[] = [];
  try {
    lintIssues = await lintDiagramFlat(diagram, effectiveConfig);
  } catch {
    // If bpmnlint fails, return empty issues gracefully
  }

  // Convert bpmnlint issues to our format, including docUrl
  const issues: ValidationIssue[] = lintIssues.map((li) => ({
    severity: li.severity,
    message: li.message,
    elementId: li.elementId,
    rule: li.rule,
    ...(li.documentationUrl ? { docUrl: li.documentationUrl } : {}),
  }));

  // Filter based on lintMinSeverity if provided
  const blockingSeverities: Set<string> = new Set(['error']);
  if (lintMinSeverity === 'warning') {
    blockingSeverities.add('warning');
  }

  const blockingIssues = issues.filter((i) => blockingSeverities.has(i.severity));

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const infos = issues.filter((i) => i.severity === 'info');

  return jsonResult({
    success: true,
    valid: blockingIssues.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    infoCount: infos.length,
    issues,
    issueCount: issues.length,
  });
}

export const TOOL_DEFINITION = {
  name: 'validate_bpmn_diagram',
  description:
    'Validate a BPMN diagram using bpmnlint rules. Returns structured issues with rule names, severities, element IDs, and documentation URLs. Uses bpmnlint:recommended by default with tuning for AI-generated diagrams. Supports custom config overrides.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      config: {
        type: 'object',
        description: 'Optional bpmnlint config override. Default extends bpmnlint:recommended.',
        properties: {
          extends: {
            description: "Config(s) to extend, e.g. 'bpmnlint:recommended'",
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          },
          rules: {
            type: 'object',
            description: 'Rule overrides, e.g. { "label-required": "off" }',
            additionalProperties: { type: 'string', enum: ['off', 'warn', 'error', 'info'] },
          },
        },
      },
      lintMinSeverity: {
        type: 'string',
        enum: ['error', 'warning'],
        description:
          "Minimum lint severity that marks the diagram as invalid. 'error' (default) counts only errors. 'warning' counts warnings too.",
      },
    },
    required: ['diagramId'],
  },
} as const;
