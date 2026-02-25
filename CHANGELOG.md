# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Architecture

- **ELK removal** — Replaced the ELK-based layout engine (~5,700 lines) with a
  rebuild-only layout engine (~2,700 lines) that uses topology-driven placement
  with bpmn-js native APIs (AutoPlace, ManhattanLayout). See ADR-018.

### Tool consolidation

- **Reduced tool count from 45 → 39.** Unregistered redundant internal handlers
  where functionality was already covered by other tools (ADR-019):
  - `optimize-lane-assignments` → `redistribute_bpmn_elements_across_lanes`
  - `resize-pool-to-fit` → `autosize_bpmn_pools_and_lanes`
  - `duplicate_bpmn_element` → `add_bpmn_element` with `copyFrom`
  - `set_bpmn_script` → `set_bpmn_element_properties` (scriptFormat/script)
  - `suggest/validate_bpmn_lane_organization` + `suggest_bpmn_pool_vs_lanes`
    → unified `analyze_bpmn_lanes` with mode parameter
- **Schema trimming** — Removed unused parameters from `add_bpmn_element`:
  `placementStrategy`, `copyOffsetX`, `copyOffsetY`.
- **Dead code removal** — Deleted `optimize-lane-assignments.ts` and
  `resize-pool-to-fit.ts` handlers and tests.

### Resources

- Added `bpmn://diagram/{diagramId}/elements` resource template — pre-populates
  element context without a tool call (alias for `list_bpmn_elements`).

### Prompts

- Added `add-subprocess-pattern` prompt — step-by-step guide for embedded
  subprocesses with boundary events.
- Added `add-message-exchange-pattern` prompt — guide for collaboration
  diagrams with message flows between pools.

### Testing

- Consolidated layout test files: merged label, loop, layout-option, and
  reference/snapshot test suites (39 → ~27 files, ~−1,500 lines).
- Added tests for `analyze_bpmn_lanes` routing, ScriptTask property handling,
  `copyFrom` parity, and batch dispatch coverage.

### Documentation

- Added ADR-019 documenting tool consolidation decisions.
