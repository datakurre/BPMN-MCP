# ADR-016: ELK Pipeline Anatomy and Fix-Chain Analysis

## Status

Accepted (Phase 0 audit)

## Context

The ELK-based layout engine (`src/elk/`, 13,010 lines across 36 files) runs a
30-step post-processing pipeline after ELK computes initial node positions. This
ADR documents every step, its purpose, and — critically — which steps exist
solely to repair damage caused by earlier post-processing steps.

## Pipeline Steps

### Group A: Node Positioning (steps 1–8)

| #   | Step                             | Lines†   | Purpose                                                                     | Fixes damage from                               |
| --- | -------------------------------- | -------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | `applyNodePositions`             | 793      | Apply ELK x/y, resize compound nodes, reposition ad-hoc subprocess children | — (initial)                                     |
| 2   | `fixBoundaryEvents` (cycle 1)    | 376+95   | Restore boundary events to correct host border after ELK drag               | Step 1 (`moveElements` drags BEs)               |
| 3   | `snapAndAlignLayers`             | 209      | Snap same-layer elements to common Y (fixes 5–10px ELK offsets)             | Step 1 (ELK rounding)                           |
| 4   | `gridSnapAndResolveOverlaps`     | 592+198  | Quantise to virtual grid + resolve overlaps from snapping                   | Step 3 (snapping creates overlaps)              |
| 5   | `repositionArtifacts`            | 364      | Place text annotations, data objects, data stores near associated elements  | — (independent)                                 |
| 6   | `alignHappyPathAndOffPathEvents` | 130+733  | Align happy path to single Y, pin branches, align close end events          | Step 4 (grid snap may shift happy path off-row) |
| 7   | `resolveOverlaps-2nd`            | (reuse)  | Fix overlaps created by happy-path alignment                                | Step 6 (pulling elements to same Y)             |
| 8   | `positionEventSubprocesses`      | (in 793) | Position event subprocesses after main flow is stable                       | — (deferred from step 1)                        |

### Group B: Pool/Boundary/Edge Transition (steps 9–13)

| #   | Step                                | Lines†     | Purpose                                                                                                                 | Fixes damage from              |
| --- | ----------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 9   | `finalisePoolsAndLanes`             | 958+793    | Centre in pools, enforce gap, reposition lanes, compact, reorder collapsed                                              | Steps 1–8 (elements moved)     |
| 10  | `finaliseBoundaryTargets` (cycle 2) | 376+95+595 | Re-restore BEs after 6 intervening steps moved hosts; position leaf targets                                             | Steps 3,4,6,7,9 all move hosts |
| 11  | `resolveOverlaps-3rd`               | (reuse)    | Fix overlaps from boundary target repositioning                                                                         | Step 10                        |
| 12  | `applyEdgeRoutes`                   | 520+112    | Apply ELK edge sections as waypoints, route self-loops, space message flows, simplify gateway branches, channel routing | — (initial edge routing)       |
| 13  | `normaliseOrigin`                   | (in 793)   | Shift all elements so diagram starts at positive coords                                                                 | — (cosmetic)                   |

### Group C: Post-Routing Repair (steps 14–21)

| #   | Step                              | Lines†   | Purpose                                                      | Fixes damage from                                                       |
| --- | --------------------------------- | -------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 14a | `fixDisconnectedEdges`            | 382      | Reconnect endpoints that ELK+grid snap disconnected          | Steps 4,6 (grid snap + alignment moved elements after ELK routed edges) |
| 14b | `croppingDockPass`                | (in 382) | Snap endpoints to actual shape boundaries (circles/diamonds) | Step 12 (ELK routes to rectangular bounds)                              |
| 14c | `rebuildOffRowGatewayRoutes`      | 632      | Rebuild L/Z-bend routes for off-row gateways                 | Step 12 (ELK routes don't account for post-ELK element moves)           |
| 14d | `separateOverlappingGatewayFlows` | (in 632) | Separate overlapping collinear flows                         | Step 12 (ELK places some flows on same line)                            |
| 14e | `simplifyCollinearWaypoints`      | 429      | Remove redundant collinear waypoints                         | Steps 14c,14d (rebuilding creates redundant points)                     |
| 14f | `removeMicroBends`                | (in 429) | Remove short wiggles from routes                             | Steps 14c–14e (route manipulation creates micro-bends)                  |
| 14g | `routeLoopbacksBelow`             | (in 632) | Route backward flows in U-shape below path                   | — (ELK doesn't handle these well)                                       |
| 14h | `bundleParallelFlows`             | (in 632) | Offset parallel same-pair flows                              | — (cosmetic)                                                            |
| 14i | `snapAllConnectionsOrthogonal`    | (in 209) | Final snap to strict orthogonal                              | Steps 14a–14h (accumulated rounding)                                    |
| 15  | `clampFlowsToLaneBounds`          | (in 958) | Clamp waypoints to lane boundaries                           | Step 12 (ELK routes ignore lanes)                                       |
| 16  | `routeCrossLaneStaircase`         | (in 958) | Route cross-lane staircase patterns                          | — (cosmetic)                                                            |
| 17  | `reduceCrossings-1st`             | 609      | Reduce edge crossings by nudging                             | Steps 14a–14i (repair may create crossings)                             |
| 18  | `avoidElementIntersections`       | 305      | Detour waypoints around element bounding boxes               | Steps 14a–14i (repair may route through elements)                       |
| 19  | `reduceCrossings-2nd`             | (reuse)  | Fix crossings introduced by avoidance                        | Step 18                                                                 |
| 20  | `avoidElementIntersections-2nd`   | (reuse)  | Fix intersections introduced by crossing reduction           | Step 19                                                                 |
| 21  | `detectCrossingFlows`             | (in 609) | Read-only: count remaining crossings                         | — (observability)                                                       |

†Line counts are for the source file containing the function, not the function itself.

## Fix-Chain Analysis

### Chain 1: Grid Snap → Overlap → Happy Path → Overlap

```
Step 4 (gridSnap)  ──creates──▶  overlaps
Step 4 (resolveOverlaps) ──fixes──▶  overlaps from gridSnap
Step 6 (alignHappyPath)  ──creates──▶  overlaps (pulls elements to same Y)
Step 7 (resolveOverlaps-2nd) ──fixes──▶  overlaps from alignHappyPath
```

**Root cause:** Grid snap moves elements off the positions ELK chose. Then happy-path
alignment moves them again. Each move can create overlaps.

### Chain 2: Boundary Event Double-Restore

```
Step 1 (applyNodePositions) ──drags──▶  boundary events to wrong border
Step 2 (fixBoundaryEvents)  ──fixes──▶  boundary event positions
Steps 3,4,6,7,9             ──drag──▶   boundary events again (host moved)
Step 10 (finaliseBoundaryTargets) ──fixes──▶  boundary events again
Step 11 (resolveOverlaps-3rd) ──fixes──▶  overlaps from BE target repositioning
```

**Root cause:** bpmn-js auto-drags boundary events when hosts move. Every step
that moves a host element invalidates boundary event positions.

### Chain 3: Edge Routing → Repair → Crossing → Avoidance → Crossing → Avoidance

```
Step 12 (applyEdgeRoutes)    ──creates──▶  disconnected endpoints, wrong shapes
Step 14a (fixDisconnected)   ──fixes──▶    disconnected endpoints
Step 14b (croppingDock)      ──fixes──▶    rectangular bounds → correct shapes
Step 14c (rebuildOffRow)     ──creates──▶  collinear overlaps, micro-bends
Step 14d (separateOverlapping) ──fixes──▶  collinear overlaps
Step 14e (simplifyCollinear) ──fixes──▶    redundant waypoints from 14c/14d
Step 14f (removeMicroBends)  ──fixes──▶    wiggles from 14c–14e
Step 14i (snapOrthogonal)    ──fixes──▶    residual diagonals from 14a–14h
Step 17 (reduceCrossings)    ──fixes──▶    crossings from 14a–14i
Step 18 (avoidIntersections) ──creates──▶  new crossings
Step 19 (reduceCrossings-2nd) ──fixes──▶   crossings from step 18
Step 20 (avoidIntersections-2nd) ──fixes──▶ intersections from step 19
```

**Root cause:** Custom edge routing (step 12) applies ELK waypoints but then
elements have been moved by 10 intervening steps (3–11). The routes are stale.
Then 9 repair sub-steps fix the stale routes, creating new issues for each other.

### Chain 4: Lane Layout Post-Hoc Shifting

```
Step 9 (finalisePoolsAndLanes) ──shifts──▶  elements into lane Y-bands
Step 10 (finaliseBoundaryTargets) ──fixes──▶ BEs dragged by lane shift
Step 15 (clampFlowsToLaneBounds)  ──fixes──▶ waypoints crossing lane borders
Step 16 (routeCrossLaneStaircase) ──fixes──▶ ugly cross-lane patterns
```

**Root cause:** ELK doesn't know about lanes. Elements are shifted into lane
bands post-hoc, which invalidates boundary events and edge routes.

## Constants Audit

### Principled spacing values (keep)

| Constant              | Value                             | Basis                                      |
| --------------------- | --------------------------------- | ------------------------------------------ |
| `ELK_LAYER_SPACING`   | 60                                | Matches bpmn-js auto-place (~58px average) |
| `ELK_NODE_SPACING`    | 50                                | Standard BPMN gap                          |
| `STANDARD_BPMN_GAP`   | 50                                | bpmn-js default                            |
| `ELEMENT_SIZES.*`     | various                           | Mirror bpmn-js defaults                    |
| `CONTAINER_PADDING`   | top=60,left=40,bottom=60,right=50 | ELK compound node padding                  |
| `PARTICIPANT_PADDING` | top=80,left=50,bottom=80,right=40 | Pool label band accommodation              |
| `DEFAULT_LABEL_SIZE`  | 90×20                             | Matches bpmn-js                            |

### Empirically-tuned magic numbers (candidates for removal)

| Constant                    | Value | Why it exists                            |
| --------------------------- | ----- | ---------------------------------------- |
| `SAME_ROW_THRESHOLD`        | 20px  | Covers ELK Y-alignment rounding          |
| `MICRO_BEND_TOLERANCE`      | 5px   | Covers ELK rounding + grid snap          |
| `SHORT_SEGMENT_THRESHOLD`   | 6px   | Empirical staircase threshold            |
| `DISCONNECT_THRESHOLD`      | 20px  | Covers grid snap displacement            |
| `ENDPOINT_SNAP_TOLERANCE`   | 15px  | Covers grid snap moving elements         |
| `MAX_WOBBLE_CORRECTION`     | 20px  | Happy-path alignment heuristic           |
| `MAX_EXTENDED_CORRECTION`   | 200px | Imported diagram heuristic               |
| `COLLINEAR_DETOUR_OFFSET`   | 20px  | Gateway flow separation                  |
| `MIN_GATEWAY_PARALLEL_GAP`  | 20px  | Gateway flow separation                  |
| `LOOPBACK_BELOW_MARGIN`     | 30px  | Loopback routing margin                  |
| `CROSSING_NUDGE_PX`         | 12px  | Crossing reduction nudge                 |
| `CHANNEL_GW_PROXIMITY`      | 40px  | Channel routing detection                |
| `MIN_CHANNEL_WIDTH`         | 30px  | Channel routing minimum                  |
| `NORMALISE_LARGE_THRESHOLD` | 40px  | Origin shift heuristic                   |
| `BOUNDARY_TARGET_Y_OFFSET`  | 85px  | Boundary target positioning              |
| `BOUNDARY_TARGET_X_OFFSET`  | 90px  | Boundary target positioning              |
| Many more...                |       | All exist to tune post-processing passes |

**~70% of the 120 constants** serve post-processing passes that wouldn't exist
if we trust ELK's output and let bpmn-js handle edge routing.

## Spike File Audit

| File                               | Lines | Finding                                                                                                  | Action                                             |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `docking-spike.test.ts`            | 159   | **CroppingConnectionDocking works headlessly.** Already adopted in step 14b.                             | Extract finding → ADR, delete spike                |
| `elk-partition-spike.test.ts`      | 198   | **ELK partitioning assigns columns, not rows, in direction=RIGHT.** Cannot replace post-hoc lane layout. | Extract finding → ADR-016 (this doc), delete spike |
| `manhattan-spike.test.ts`          | 159   | **ManhattanLayout works headlessly.** Partially adopted in subset-layout.                                | Extract finding → ADR, delete spike                |
| `label-baseline-spike.test.ts`     | 163   | **`getExternalLabelMid()` works headlessly.** Not yet adopted.                                           | Extract finding → ADR, delete spike                |
| `autoplace.test.ts` (C2-5 section) | ~100  | **AutoPlace works headlessly.** Not yet adopted.                                                         | Extract finding → ADR, keep C2-3/C2-6 tests        |

### Key finding from ELK partition spike

ELK's `elk.partitioning.activate` with `elk.partitioning.partition` assigns
nodes to **layer groups (columns)** in `direction=RIGHT`, NOT horizontal bands.
This means ELK partitioning cannot directly produce BPMN lane separation for
horizontal-flow diagrams. The post-hoc lane layout (`lane-layout.ts`) is
necessary for direction=RIGHT. However, for `direction=DOWN`, ELK partitioning
_would_ work. This limits Phase 3's ability to eliminate `lane-layout.ts` for
the default (RIGHT) direction.

## Decision

This ADR is informational. It provides the baseline understanding for Phases 1–7
of the layout sanity restoration plan. Key conclusions:

1. **3 of 4 fix-chains** (grid snap, edge routing repair, lane post-hoc) would
   be eliminated by trusting ELK's output and using bpmn-js for edge routing.
2. **The boundary event double-restore** (chain 2) is inherent to how bpmn-js
   drags boundary events — it cannot be fully eliminated but can be reduced to
   one restore cycle if intervening host-moving steps are removed.
3. **~70% of constants** serve post-processing passes targeted for removal.
4. **All 5 spike findings confirm** that bpmn-js services (AutoPlace,
   ManhattanLayout, CroppingConnectionDocking, getExternalLabelMid) work
   headlessly in jsdom.
