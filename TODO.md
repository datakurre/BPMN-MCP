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
| 6 | Event-based + Timer + Error boundary | Complex | ⏳ Pending — see build recipe below |
| 7 | Full executable with error compensation | Complex | ⏳ Pending — see build recipe below |

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

---

## Pending Diagram Recipes & Potential Issues

### Diagram 6 — Event-based: Timer + Error Boundary Events

**Purpose:** Verify that `analyze_bpmn_lanes` handles BPMN intermediate and boundary events
correctly, specifically `bpmn:BoundaryEvent` nodes that are attached to tasks but are
separate business objects in `process.flowElements`.

**Build recipe (MCP tool calls in order):**
```
1. create_bpmn_diagram { name: "Support Ticket Process" }
2. create_bpmn_participant { name: "Support Ticket Process",
     lanes: [{ name: "Customer" }, { name: "Support Agent" }, { name: "System" }] }
3. add_bpmn_element bpmn:StartEvent    "Ticket Submitted"   laneId=Customer
4. add_bpmn_element bpmn:UserTask      "Describe Issue"     laneId=Customer
5. add_bpmn_element bpmn:UserTask      "Triage Ticket"      laneId=Support Agent
6. add_bpmn_element bpmn:ExclusiveGateway "Issue Type?"     laneId=Support Agent
7. add_bpmn_element bpmn:UserTask      "Resolve Manually"   laneId=Support Agent
8. add_bpmn_element bpmn:ServiceTask   "Auto-Resolve"       laneId=System
     camunda:type=external, camunda:topic=auto-resolve, camunda:asyncBefore=true
9. add_bpmn_element bpmn:UserTask      "Confirm Resolution" laneId=Customer
10. add_bpmn_element bpmn:EndEvent     "Ticket Closed"      laneId=Customer

# Timer boundary event on "Triage Ticket" (non-interrupting escalation)
11. add_bpmn_element bpmn:BoundaryEvent  hostElementId=<TriageTicket id>
      cancelActivity=false
    set_bpmn_event_definition { eventDefinitionType: "bpmn:TimerEventDefinition",
      properties: { timeDuration: "PT4H" } }
12. add_bpmn_element bpmn:UserTask "Escalate to Senior Agent"  laneId=Support Agent
    connect_bpmn_elements TimerBoundaryEvent → EscalateTask

# Error boundary event on "Auto-Resolve" (interrupting error handler)
13. add_bpmn_element bpmn:BoundaryEvent  hostElementId=<AutoResolve id>
    set_bpmn_event_definition { eventDefinitionType: "bpmn:ErrorEventDefinition",
      errorRef: { id: "Error_AutoResolveFailed", name: "Auto-Resolve Failed" } }
14. add_bpmn_element bpmn:UserTask "Handle Resolution Error"  laneId=Support Agent
    connect_bpmn_elements ErrorBoundaryEvent → HandleErrorTask

# Connect main flow
15. connect_bpmn_elements: Start → DescribeIssue → TriageTicket → Gateway
      Gateway →[Manual] ResolveManually → ConfirmResolution → End
      Gateway →[Auto]   AutoResolve     → ConfirmResolution

16. set_bpmn_form_data DescribeIssue: [{ id:"description", label:"Issue Description",
      type:"string", validation:[{name:"required"}] }]
17. set_bpmn_element_properties DescribeIssue: { "camunda:candidateGroups": "customer" }
18. set_bpmn_element_properties TriageTicket:  { "camunda:candidateGroups": "support" }
19. set_bpmn_element_properties ResolveManually: { "camunda:candidateGroups": "support" }
20. set_bpmn_element_properties EscalateTask:    { "camunda:candidateGroups": "support" }
21. set_bpmn_element_properties ConfirmResolution: { "camunda:candidateGroups": "customer" }
22. set_bpmn_element_properties HandleErrorTask: { "camunda:candidateGroups": "support" }

23. layout_bpmn_diagram
24. analyze_bpmn_lanes mode=suggest
25. analyze_bpmn_lanes mode=validate
26. export_bpmn
```

**What to evaluate:**

| Check | Expected | Watch For |
|-------|----------|-----------|
| `layout_bpmn_diagram` → `diWarnings` | empty array | false-positive pool/lane warnings (Issue C regression) |
| `validate` → `issues[].code` | no `elements-not-in-lane` | **Potential Issue E**: BoundaryEvents flagged as unassigned |
| `validate` → `totalFlowNodes` | matches visible node count | miscount if BoundaryEvents double-counted |
| `suggest` → lane names | "customer", "support", "Automated Tasks" | BoundaryEvents appear in suggestions as a spurious lane |
| `suggest` → `suggestions[].elementIds` | no boundary event IDs in any suggestion | boundary events should NOT be grouped into task lanes |
| `export_bpmn` | lint passes | no errors |

---

### Potential Issue E — `validate` mode: BoundaryEvents may be flagged as unassigned flow nodes

**Status:** ⚠️ Unverified — requires building Diagram 6 to confirm

**File:** `src/handlers/collaboration/analyze-lanes.ts` → `partitionFlowElements()`

**Symptom (expected):** After building Diagram 6, `analyze_bpmn_lanes(mode: validate)` returns
an `elements-not-in-lane` warning mentioning the timer boundary event or error boundary event
by ID/name, even though they are visually positioned on tasks that ARE in lanes.

**Root cause (hypothesis):**
`partitionFlowElements()` at line ~533 filters `process.flowElements` to produce `flowNodes`:
```typescript
const flowNodes = flowElements.filter(
  (el: any) =>
    el.$type !== 'bpmn:SequenceFlow' &&
    !el.$type.includes('Association') &&
    !el.$type.includes('DataInput') &&
    !el.$type.includes('DataOutput')
);
```
`bpmn:BoundaryEvent` passes all four predicates, so it enters `flowNodes`.
`checkUnassigned(flowNodes, laneMap, issues)` then checks `!laneMap.has(node.id)`.
`laneMap` is built from `lane.flowNodeRef` only. Whether bpmn-js automatically adds
BoundaryEvents to their host task's lane's `flowNodeRef` is what determines if this
is a bug. If it does not, every BoundaryEvent triggers a false-positive warning.

**Contrast with suggest mode:** `isFlowControlSuggest('bpmn:BoundaryEvent')` returns `true`
(because `'bpmn:BoundaryEvent'.includes('Event')` is `true`), so suggest mode correctly
excludes BoundaryEvents from the unassigned bucket and treats them as flow-control elements
to be distributed by `appendFlowControlToSuggestions`. The validate mode lacks this guard.

**Proposed fix (if confirmed):**
In `partitionFlowElements`, exclude BoundaryEvents from `flowNodes` (they inherit their
host's lane and don't need independent lane assignment). OR in `checkUnassigned`, filter
out nodes whose `$type === 'bpmn:BoundaryEvent'` before flagging.

```typescript
// Option A — in partitionFlowElements:
const flowNodes = flowElements.filter(
  (el: any) =>
    el.$type !== 'bpmn:SequenceFlow' &&
    el.$type !== 'bpmn:BoundaryEvent' &&   // ← add this line
    !el.$type.includes('Association') &&
    !el.$type.includes('DataInput') &&
    !el.$type.includes('DataOutput')
);

// Option B — in checkUnassigned (more targeted):
const unassigned = flowNodes.filter(
  (node: any) => !laneMap.has(node.id) && node.$type !== 'bpmn:BoundaryEvent'
);
```

**TDD — write these tests FIRST (they should fail before the fix):**

```typescript
// test/handlers/collaboration/analyze-lanes-boundary-events.test.ts
import { handleAnalyzeLanes } from '../../../src/handlers/collaboration/analyze-lanes';
import { handleCreateParticipant, handleSetEventDefinition, handleCreateLanes }
  from '../../../src/handlers';
import { handleAddElement as rawAddElement } from '../../../src/handlers';
import { createDiagram, addElement, connect, parseResult, clearDiagrams } from '../../helpers';

describe('Issue E — BoundaryEvents should not appear as unassigned in validate mode', () => {
  beforeEach(() => clearDiagrams());

  test('timer boundary event on task in a lane does NOT trigger elements-not-in-lane', async () => {
    const diagramId = await createDiagram();
    const poolRes = parseResult(await handleCreateParticipant({ diagramId, name: 'Pool' }));
    const participantId = poolRes.participantId;
    const lanesRes = parseResult(await handleCreateLanes({
      diagramId, participantId,
      lanes: [{ name: 'Agent' }, { name: 'System' }],
    }));
    const agentLaneId = lanesRes.laneIds[0];

    const task = await addElement(diagramId, 'bpmn:UserTask',
      { name: 'Handle Request', laneId: agentLaneId });
    // Add timer boundary event attached to the task
    await rawAddElement({
      diagramId,
      elementType: 'bpmn:BoundaryEvent',
      hostElementId: task,
      eventDefinitionType: 'bpmn:TimerEventDefinition',
      eventDefinitionProperties: { timeDuration: 'PT1H' },
    });

    const res = parseResult(await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId }));

    const unassignedIssues = res.issues.filter((i: any) => i.code === 'elements-not-in-lane');
    expect(unassignedIssues).toHaveLength(0);  // ← should fail before fix
  });

  test('error boundary event on task in a lane does NOT trigger elements-not-in-lane', async () => {
    // similar setup with bpmn:ErrorEventDefinition boundary event
    // expect no elements-not-in-lane issues
  });

  test('BoundaryEvent IDs do not appear in any suggest-mode suggestion elementIds', async () => {
    // build diagram with boundary event
    // run suggest, collect all suggestion.elementIds arrays
    // assert no boundary event ID appears in any of them
  });
});
```

**Test file location:** `test/handlers/collaboration/analyze-lanes-boundary-events.test.ts`

---

### Diagram 7 — Full Executable with Error Compensation

**Purpose:** Verify `analyze_bpmn_lanes` handles compensation tasks
(`isForCompensation: true`), which are ordinary ServiceTask/Task elements with no
incoming sequence flow — connected only via a compensation association from a boundary event.

**Build recipe (MCP tool calls in order):**
```
1. create_bpmn_diagram { name: "Payment Process with Compensation" }
2. create_bpmn_participant { name: "Payment Process",
     lanes: [{ name: "Customer" }, { name: "Finance" }, { name: "System" }] }
3. add_bpmn_element bpmn:StartEvent  "Payment Initiated"     laneId=Customer
4. add_bpmn_element bpmn:UserTask    "Enter Payment Details" laneId=Customer
     camunda:candidateGroups=customer
     set_bpmn_form_data: amount(long,required), cardNumber(string,required)
5. add_bpmn_element bpmn:ServiceTask "Reserve Funds"         laneId=System
     camunda:type=external, camunda:topic=reserve-funds, camunda:asyncBefore=true
6. add_bpmn_element bpmn:ServiceTask "Charge Card"           laneId=System
     camunda:type=external, camunda:topic=charge-card,  camunda:asyncBefore=true
7. add_bpmn_element bpmn:ExclusiveGateway "Payment OK?"      laneId=Finance
8. add_bpmn_element bpmn:UserTask    "Review Failure"        laneId=Finance
     camunda:candidateGroups=finance
9. add_bpmn_element bpmn:EndEvent    "Payment Complete"      laneId=Customer
10. add_bpmn_element bpmn:EndEvent   "Payment Failed"        laneId=Customer

# Compensation boundary event on "Reserve Funds"
11. add_bpmn_element bpmn:BoundaryEvent  hostElementId=<ReserveFunds id>
      cancelActivity=false (non-interrupting compensate)
    set_bpmn_event_definition { eventDefinitionType: "bpmn:CompensateEventDefinition" }
12. add_bpmn_element bpmn:ServiceTask "Release Reserved Funds" laneId=System
      camunda:type=external, camunda:topic=release-funds
      set_bpmn_element_properties: { isForCompensation: true }
    connect_bpmn_elements CompensateBoundary → ReleaseReservedFunds (Association)

# Error boundary event on "Charge Card"
13. add_bpmn_element bpmn:BoundaryEvent  hostElementId=<ChargeCard id>
    set_bpmn_event_definition { eventDefinitionType: "bpmn:ErrorEventDefinition",
      errorRef: { id: "Error_ChargeFailed", name: "Charge Failed" } }
14. connect_bpmn_elements ErrorBoundary → ReviewFailure

# Main flow
15. connect_bpmn_elements: Start → EnterDetails → ReserveFunds → ChargeCard
      → Gateway →[OK] PaymentComplete
                →[Failed] ReviewFailure → PaymentFailed

16. layout_bpmn_diagram
17. analyze_bpmn_lanes mode=suggest
18. analyze_bpmn_lanes mode=validate
19. export_bpmn
```

**What to evaluate:**

| Check | Expected | Watch For |
|-------|----------|-----------|
| `validate` → `totalFlowNodes` | count of visible nodes only | **Potential Issue F**: `Release Reserved Funds` (isForCompensation) counted and flagged |
| `validate` → `issues[].code` | no `elements-not-in-lane` | compensation handler ServiceTask not in flowNodeRef |
| `suggest` → suggestions | "customer", "finance", "Automated Tasks" | compensation handlers incorrectly merged with regular service tasks |
| `suggest` → "Automated Tasks" elementNames | should NOT include "Release Reserved Funds" OR it should be labelled differently | compensation handlers are not ordinary automated tasks |

---

### Potential Issue F — `validate` mode: compensation handler tasks trigger false-positive `elements-not-in-lane`

**Status:** ⚠️ Unverified — requires building Diagram 7 to confirm

**File:** `src/handlers/collaboration/analyze-lanes.ts` → `partitionFlowElements()` and
`checkUnassigned()`

**Symptom (expected):** After building Diagram 7, `analyze_bpmn_lanes(mode: validate)` returns
an `elements-not-in-lane` warning for `"Release Reserved Funds"` (the compensation handler
ServiceTask), even though it is placed inside a lane in the diagram editor.

**Root cause (hypothesis):**
Compensation handler tasks (`isForCompensation: true` on a bpmn:ServiceTask) have no
incoming SequenceFlow — they're connected via a CompensateEventDefinition association.
bpmn-js may not add them to `lane.flowNodeRef` during placement because they're treated
differently from normal flow elements. The `partitionFlowElements` filter includes them
(they're a ServiceTask, which passes all predicates), but `buildLaneMap` won't find them
if they lack a `flowNodeRef` entry.

**Proposed fix (if confirmed):**
Extend `partitionFlowElements` (or `checkUnassigned`) to exclude nodes where
`el.isForCompensation === true`:

```typescript
// Option A — filter in partitionFlowElements:
const flowNodes = flowElements.filter(
  (el: any) =>
    el.$type !== 'bpmn:SequenceFlow' &&
    el.$type !== 'bpmn:BoundaryEvent' &&
    !el.isForCompensation &&           // ← add this line
    !el.$type.includes('Association') &&
    !el.$type.includes('DataInput') &&
    !el.$type.includes('DataOutput')
);
```

**TDD — write these tests FIRST (they should fail before the fix):**

```typescript
// test/handlers/collaboration/analyze-lanes-compensation.test.ts
describe('Issue F — compensation handler tasks should not appear as unassigned', () => {
  test('ServiceTask with isForCompensation=true does NOT trigger elements-not-in-lane', async () => {
    const diagramId = await createDiagram();
    // Create pool with System lane
    // Add ServiceTask "Charge Card" to System lane
    // Add CompensateBoundaryEvent on ChargeCard
    // Add ServiceTask "Refund Card" with isForCompensation=true to System lane
    // Connect boundary event to compensation handler via association

    const res = parseResult(await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId }));

    const unassignedIssues = res.issues.filter((i: any) => i.code === 'elements-not-in-lane');
    expect(unassignedIssues).toHaveLength(0);  // ← should fail before fix
  });

  test('compensation handler ServiceTask is excluded from suggest mode element count', async () => {
    // Same setup
    // Compensation handlers should not appear in any suggest lane's elementIds
    // OR should be in a distinct "Compensation Handlers" group, not "Automated Tasks"
  });
});
```

**Test file location:** `test/handlers/collaboration/analyze-lanes-compensation.test.ts`

---

### Potential Issue G — `suggest` mode: compensation handlers mixed into "Automated Tasks"

**Status:** ⚠️ Unverified — requires building Diagram 7 to confirm

**File:** `src/handlers/collaboration/analyze-lanes.ts` → `buildRoleSuggestions()` /
`isFlowControlSuggest()`

**Symptom (expected):** In `suggest` mode for Diagram 7, `"Release Reserved Funds"` (a
`bpmn:ServiceTask` with `isForCompensation: true`) appears in the `"Automated Tasks"` lane
suggestion alongside regular `bpmn:ServiceTask` elements like `"Reserve Funds"`. This is
misleading because compensation handlers are not part of the normal flow — they're invoked
exclusively by compensation events.

**Root cause:**
`buildRoleSuggestions` at line ~155 checks `!isFlowControlSuggest(n.$type)` to exclude
flow-control elements from the unassigned bucket. `isFlowControlSuggest('bpmn:ServiceTask')`
returns `false`, so all ServiceTasks (including compensation handlers) end up in "Automated
Tasks". There is no check for `isForCompensation`.

**Proposed fix:**
Extend `isFlowControlSuggest` (or add a separate predicate) to also exclude compensation
handlers:

```typescript
function isCompensationHandler(node: any): boolean {
  return node.isForCompensation === true;
}

// In buildRoleSuggestions, filter out compensation handlers from unassigned:
const unassigned = flowNodes.filter(
  (n: any) =>
    !assignedIds.has(n.id) &&
    !isFlowControlSuggest(n.$type) &&
    !isCompensationHandler(n)          // ← add this
);
```

Alternatively, add `"Compensation Handlers"` as a distinct named group so the suggest output
is semantically accurate. This is the more informative choice for AI callers.

**TDD stub:**
```typescript
test('compensation handler ServiceTask is NOT included in "Automated Tasks" lane suggestions', async () => {
  // Setup: one regular ServiceTask (candidateGroups=system) + one with isForCompensation=true
  const res = parseResult(await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId }));
  const automatedSuggestion = res.suggestions.find((s: any) => s.laneName === 'Automated Tasks');
  // Compensation handler must not appear in Automated Tasks
  expect(automatedSuggestion?.elementNames ?? []).not.toContain('Release Reserved Funds');
});
```

**Test file location:** `test/handlers/collaboration/analyze-lanes-compensation.test.ts`
(same file as Issue F tests — same setup)

---

## How to Work on Pending Items (TDD Workflow)

1. **Write the failing test first** — use the stubs above, run `npx vitest run <test-file>` to confirm it fails
2. **Build the diagram** using the recipe above to observe the actual behavior
3. **Compare** actual vs. expected — confirm the issue exists (or close it if bpmn-js handles it correctly)
4. **Apply the proposed fix** in `src/handlers/collaboration/analyze-lanes.ts`
5. **`npm run build && npm run typecheck`** — must exit 0
6. **Run the new tests** — must now pass
7. **Run `npm test`** — all existing tests must still pass
8. **Commit** with message format:
   `fix(analyze-lanes): <short description of fix>`
   Body should reference the Issue letter (E, F, or G) and the test file.
