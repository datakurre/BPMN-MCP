# ADR-019: Tool Consolidation — Unregistering Redundant Internal Handlers

## Status

Accepted

## Context

The MCP server accumulated multiple handlers where functionality overlapped
or was subsumed by other tools:

- `handleOptimizeLaneAssignments` performed lane rebalancing, but
  `redistribute_bpmn_elements_across_lanes` already covers all strategies
  (role-based, balance, minimize-crossings, manual).
- `handleResizePoolToFit` resized pools to fit their contents, but
  `autosize_bpmn_pools_and_lanes` already handles this with lane-aware
  proportional sizing.
- `handleDuplicateElement` was a standalone duplicate tool, but
  `add_bpmn_element` with `copyFrom` provides the same functionality
  with better placement control via `afterElementId`.
- `handleSetScript` set script content on ScriptTasks, but
  `set_bpmn_element_properties` now handles `scriptFormat`, `script`,
  and `camunda:resultVariable` directly.
- `handleSuggestLaneOrganization`, `handleValidateLaneOrganization`, and
  `handleSuggestPoolVsLanes` were three separate tools that could be
  unified under a single `analyze_bpmn_lanes` facade with mode parameter.

Maintaining separate MCP tool registrations for overlapping functionality
increases the tool surface area without adding value, and increases the
chance of AI callers choosing suboptimal tools.

## Decision

1. **Unregister** the following handlers from the MCP tool registry
   (keeping the handler functions as internal utilities):
   - `optimize-lane-assignments` (replaced by `redistribute_bpmn_elements_across_lanes`)
   - `resize-pool-to-fit` (replaced by `autosize_bpmn_pools_and_lanes`)
   - `duplicate_bpmn_element` (replaced by `add_bpmn_element` `copyFrom`)
   - `set_bpmn_script` (replaced by `set_bpmn_element_properties`)
   - `suggest_bpmn_lane_organization` (folded into `analyze_bpmn_lanes`)
   - `validate_bpmn_lane_organization` (folded into `analyze_bpmn_lanes`)
   - `suggest_bpmn_pool_vs_lanes` (folded into `analyze_bpmn_lanes`)

2. **Remove dead code** where unregistered handlers have no internal callers:
   - Deleted `src/handlers/collaboration/optimize-lane-assignments.ts`
   - Deleted `src/handlers/collaboration/resize-pool-to-fit.ts`
   - Deleted corresponding test files

3. **Trim schema noise** on remaining tools:
   - Removed `placementStrategy` from `add_bpmn_element` (validated but
     never affected positioning)
   - Removed `copyOffsetX`/`copyOffsetY` from `add_bpmn_element`
     (`afterElementId` is preferred for placement)

## Consequences

- Tool count reduced from 45 to 39 (−13%).
- AI callers have fewer tools to evaluate, reducing selection confusion.
- Internal handler functions remain available for batch operations and
  other handler-level calls.
- No functionality loss: every capability previously exposed via the
  removed tools is available through the consolidated alternatives.
