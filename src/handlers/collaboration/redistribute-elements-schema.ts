/**
 * JSON Schema for the redistribute_bpmn_elements_across_lanes tool.
 *
 * Extracted from redistribute-elements-across-lanes.ts to stay within lint line limits.
 */

export const TOOL_DEFINITION = {
  name: 'redistribute_bpmn_elements_across_lanes',
  description:
    'Rebalance element placement across existing lanes in a pool. Analyzes assignee/role patterns, ' +
    'flow-neighbor connections, and lane capacity to produce a better distribution. ' +
    'Use when lanes become overcrowded or when elements are not optimally assigned after initial creation. ' +
    'Set validate=true to run lane validation before and after redistribution, reporting before/after ' +
    'coherence metrics and skipping changes when organization is already good (the optimize flow). ' +
    'Supports dry-run mode to preview changes before applying them.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: { type: 'string', description: 'The diagram ID' },
      participantId: {
        type: 'string',
        description:
          'The ID of the participant (pool) whose lanes to rebalance. ' +
          'When omitted, auto-detects the first participant with at least 2 lanes.',
      },
      strategy: {
        type: 'string',
        enum: ['role-based', 'balance', 'minimize-crossings', 'manual'],
        description:
          "Redistribution strategy: 'role-based' (default) matches assignee/candidateGroups to lane names; " +
          "'balance' spreads elements evenly while respecting roles; " +
          "'minimize-crossings' minimizes cross-lane sequence flows; " +
          "'manual' directly assigns specified elementIds to a target laneId.",
      },
      laneId: {
        type: 'string',
        description: "Target lane ID for 'manual' strategy.",
      },
      elementIds: {
        type: 'array',
        items: { type: 'string' },
        description: "Element IDs to assign to the lane (required for 'manual' strategy).",
      },
      reposition: {
        type: 'boolean',
        description:
          'When true (default), repositions elements vertically into their new lane bounds. ' +
          'Set to false to only update lane membership without moving elements.',
      },
      dryRun: {
        type: 'boolean',
        description: 'When true, returns the redistribution plan without applying any changes.',
      },
      validate: {
        type: 'boolean',
        description:
          'When true, runs lane validation before and after redistribution. ' +
          'Skips changes if organization is already good (coherence ≥ 70%). ' +
          'Reports before/after coherence metrics showing the improvement. ' +
          'Uses minimize-crossings strategy by default in validate mode.',
      },
    },
    required: ['diagramId'],
  },
} as const;
