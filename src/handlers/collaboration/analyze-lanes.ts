/**
 * Handler for analyze_bpmn_lanes tool.
 *
 * Unified lane analysis tool that merges three former standalone tools:
 * - suggest_bpmn_lane_organization → mode: 'suggest'
 * - validate_bpmn_lane_organization → mode: 'validate'
 * - suggest_bpmn_pool_vs_lanes → mode: 'pool-vs-lanes'
 */
// @readonly

import { type ToolResult } from '../../types';
import { validateArgs } from '../helpers';
import { handleSuggestLaneOrganization } from './suggest-lane-organization';
import { handleValidateLaneOrganization } from './validate-lane-organization';
import { handleSuggestPoolVsLanes } from './suggest-pool-vs-lanes';

export interface AnalyzeLanesArgs {
  diagramId: string;
  mode: 'suggest' | 'validate' | 'pool-vs-lanes';
  participantId?: string;
}

export async function handleAnalyzeLanes(args: AnalyzeLanesArgs): Promise<ToolResult> {
  validateArgs(args, ['diagramId', 'mode']);

  switch (args.mode) {
    case 'suggest':
      return handleSuggestLaneOrganization({
        diagramId: args.diagramId,
        participantId: args.participantId,
      });
    case 'validate':
      return handleValidateLaneOrganization({
        diagramId: args.diagramId,
        participantId: args.participantId,
      });
    case 'pool-vs-lanes':
      return handleSuggestPoolVsLanes({
        diagramId: args.diagramId,
      });
    default:
      return handleSuggestLaneOrganization({
        diagramId: args.diagramId,
        participantId: args.participantId,
      });
  }
}

export const TOOL_DEFINITION = {
  name: 'analyze_bpmn_lanes',
  description:
    'Analyze lane organization in a BPMN diagram. Three modes: ' +
    "'suggest' — analyze tasks and suggest optimal lane assignments based on roles (camunda:assignee/candidateGroups) " +
    'or element types (human vs automated). Returns structured suggestions with lane names, coherence score, and reasoning. ' +
    "'validate' — check if current lane assignment makes semantic sense by analyzing cross-lane flow frequency, " +
    'zigzag patterns, single-element lanes, and overall coherence. Returns structured issues with fix suggestions. ' +
    "'pool-vs-lanes' — evaluate whether a collaboration should use separate pools (different organizations/systems) " +
    'or lanes (role separation within one organization). Returns recommendation with confidence and reasoning.',
  inputSchema: {
    type: 'object',
    properties: {
      diagramId: {
        type: 'string',
        description: 'The diagram ID',
      },
      mode: {
        type: 'string',
        enum: ['suggest', 'validate', 'pool-vs-lanes'],
        description:
          "Analysis mode: 'suggest' for lane assignment recommendations, " +
          "'validate' for checking current lane organization quality, " +
          "'pool-vs-lanes' for deciding between pools and lanes.",
      },
      participantId: {
        type: 'string',
        description:
          "Optional participant ID to scope the analysis (used with 'suggest' and 'validate' modes).",
      },
    },
    required: ['diagramId', 'mode'],
  },
} as const;
