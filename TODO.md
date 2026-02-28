# BPMN Diagram Evaluation & Lane Analysis — Work Log

## Goal
Build progressively more complex executable BPMN diagrams using the MCP tools,
evaluating `analyze_bpmn_lanes` results at each stage, and iterating on any
issues found in the service.

---

## Diagrams Planned

| # | Name | Complexity | Status |
|---|------|------------|--------|
| 1 | Simple Linear (User Tasks only) | Trivial | ✅ Done |
| 2 | User Tasks + Service Tasks | Simple | ✅ Done |
| 3 | Exclusive Gateway (decision) | Medium | ✅ Done |
| 4 | Parallel Gateway | Medium | ✅ Done |
| 5 | Full Executable Order Processing (4 lanes, 2 GWs) | Complex | ✅ Done — exported to `example.bpmn` |
| 6 | Event-based + Timer + Error boundary | Complex | ⏳ Pending |
| 7 | Full executable with error compensation | Complex | ⏳ Pending |

---

## Issues Found

### Issue A — EL expressions used as lane names in `suggest` mode ⚠️ **HIGH**
**File:** `src/handlers/collaboration/analyze-lanes.ts` → `extractPrimaryRoleSuggest()`  
**Symptom:** When `camunda:assignee` is an EL expression like `${initiator}`, the suggest
mode proposes a lane named `"${initiator}"` instead of using `camunda:candidateGroups`
(e.g. `"employee"`).  
**Fix:** In `extractPrimaryRoleSuggest`, skip assignee values that match `${…}` pattern;
fall through to `candidateGroups`.

---

### Issue B — External ServiceTasks always labeled "Unassigned" ⚠️ **MEDIUM**
**File:** `src/handlers/collaboration/analyze-lanes.ts` → `buildRoleSuggestions()`  
**Symptom:** Service tasks configured with `camunda:type=external` have no
`candidateGroups`, so the suggest mode puts them in an "Unassigned" bucket even when
the current lane assignment is semantically correct (e.g. a "System" lane).  
**Fix:** When all unassigned elements are automated task types (ServiceTask, ScriptTask,
etc.), name the group "Automated Tasks" instead of "Unassigned".

---

### Issue C — `checkDiIntegrity` produces false-positive warnings for pools/lanes ℹ️ **LOW**
**File:** `src/handlers/layout/layout-di-repair.ts` → `checkDiIntegrity()`  
**Symptom:** After `layout_bpmn_diagram`, the response includes `diWarnings` like
`"⚠️ DI integrity: "Loan Application Process" (bpmn:Participant) exists in process but
has no visual shape."` even though the exported BPMN XML contains correct DI shapes.  
**Root cause:** `checkDiIntegrity` builds `registeredIds` using only `el.id`, while
`repairDiIntegrity` (which runs first) adds BOTH `el.id` AND `el.businessObject?.id`.
After the repair adds shapes with ID collisions, the subsequent check finds residual
entries under the business-object ID that aren't in its id-only set.  
**Fix:** In `checkDiIntegrity`, also add `el.businessObject?.id` to `registeredIds`.

---

### Issue D — `suggest` mode coherence score diverges from `validate` mode ℹ️ **INFO**
**Observation:** The same diagram can show 78% coherence in `suggest` mode vs 44% in
`validate` mode. This is actually **by design** — suggest measures the *proposed* layout,
validate measures the *current* layout. However the response text doesn't make this clear.  
**Fix:** Add a note in the `suggest` mode response clarifying it shows coherence of the
*proposed* assignment, not the current one.

---

## Work Log

### 2026-02-28 — Session started
- Service builds cleanly (`npm run build` exits 0)
- Evaluation plan created

### 2026-02-28 — Diagrams built & evaluated
| # | Diagram | Analysis Results |
|---|---------|-----------------|
| 1 | Leave Request (3 lanes, User Tasks only) | suggest: 50%, validate: 50%, Issue A triggered |
| 2 | Order Processing (User Tasks + External STs) | suggest: 83%, validate: 33%, Issues A+B triggered |
| 3 | Loan Application (Exclusive GW) | suggest: 78%, validate: 44%, Issues B+C triggered |
| 4 | Invoice Processing (Parallel GW) | suggest: 78%, validate: 44%, Issues B+C triggered |

### 2026-02-28 — Fixes in progress
- [x] Fix A: Skip EL expressions in `extractPrimaryRoleSuggest`
- [x] Fix B: Label all-automated unassigned groups "Automated Tasks"
- [x] Fix C: Add `businessObject?.id` to `checkDiIntegrity` registered set
- [x] Fix D: Clarify suggest-mode response text about proposed vs current coherence

### 2026-02-28 — Fix verification (Diagram 5)
- Diagram 5: Full Executable Order Processing (4 lanes: Customer/Sales/Warehouse/Finance)
  - 7 tasks (4 UserTask + 3 external ServiceTask), 2 ExclusiveGateways, 3 events
  - `layout_bpmn_diagram`: **zero diWarnings** (Fix C confirmed ✅)
  - `suggest`: 58% proposed coherence, ServiceTasks correctly in "Automated Tasks" (Fix B ✅)
  - `validate`: 50% current coherence, only 1 info issue (intentional gateway cross-lane flows)
  - `coherenceNote` present in suggest output (Fix D ✅)
  - Lane names: "customer", "sales", "warehouse" (not EL expressions — Fix A ✅)
  - Exported cleanly to `example.bpmn` (lint passed)

### 2026-02-28 — Regression tests written & committed
- **File:** `test/handlers/collaboration/analyze-lanes-regression.test.ts`
- **11 test cases** covering all 4 fixes
- All 1265 tests pass (180 test files)
- Committed as `a909428` — "fix(analyze-lanes): fix EL expression lane names..."
