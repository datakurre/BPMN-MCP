# ADR-017: Layout Simplification Outcome

## Status

Accepted (Phase 7 validation)

## Context

The ELK-based layout engine was audited (ADR-016) and found to contain a 30-step
post-processing pipeline where many steps existed solely to repair damage caused
by earlier steps. Phases 1–5 simplified the pipeline while Phases 6–7 cleaned up
tests and validated the results.

## Decision

The layout system was simplified from a 30-step post-processing pipeline to an
8-step pipeline that delegates more work to ELK's built-in Sugiyama layered
algorithm and bpmn-js's ManhattanLayout for edge routing. The key changes:

### Removed subsystems (Phases 2–4)

- **Custom edge routing** — replaced by bpmn-js ManhattanLayout (built-in
  orthogonal routing with cropping connection docking)
- **Grid snap and overlap resolution** — ELK's native node placement is
  sufficient; post-ELK grid snapping available via `gridSnap` option
- **Happy-path alignment** — ELK's layered algorithm naturally produces
  left-to-right flow; explicit happy-path pinning removed
- **Custom label scoring** — replaced by geometry-based label adjustment
  (ADR-012) that positions labels away from connection paths
- **Crossing reduction** — ELK's built-in crossing minimisation is used instead
- **Channel routing** — removed; ManhattanLayout handles routing

### Retained subsystems

- **ELK graph building** — converts bpmn-js element registry to ELK graph
- **Position application** — applies ELK results back to bpmn-js canvas
- **Boundary event positioning** — saves/restores boundary events during layout
- **Boundary chains** — handles exception flow chains from boundary events
- **Artifact positioning** — places data objects, stores, and annotations
- **Lane layout** — positions elements within lane bands
- **Label adjustment** — geometry-based label positioning (ADR-012)

### Current pipeline (8 steps)

1. Save boundary event positions
2. Build ELK graph
3. Run ELK layout
4. Apply node positions
5. Restore boundary events to host borders
6. Position boundary exception chains
7. Position artifacts near associated elements
8. Adjust labels

## Performance Results

Benchmarked on the simplified pipeline:

| Diagram                    | Elements | Layout Time |
| -------------------------- | -------- | ----------- |
| Simple (linear)            | 5        | ~100ms      |
| Medium (branches)          | ~20      | ~140ms      |
| Large (parallel branches)  | 50+      | ~620ms      |
| Collaboration (multi-pool) | ~15      | ~130ms      |

All layouts complete well within acceptable time limits.

## Validation Results

### Test coverage

- **53 original acceptance tests**: all pass
- **5 new acceptance stories** added (stories 8–12):
  - Incremental building (bpmn-js-style placement without layout)
  - Incremental editing (import + modify without displacement)
  - Full re-layout of all 10 reference diagrams
  - Edge case verification (9 patterns)
  - Performance benchmarks (4 scenarios)
- **Total acceptance tests**: 86 passing
- **Total test suite**: 200+ test files, 1300+ tests, all passing

### Edge cases verified

- Boundary events on host border ✓
- Expanded subprocesses with proper sizing ✓
- Collapsed subprocesses ✓
- Event subprocesses ✓
- Lanes with Y-band separation ✓
- Message flows across pools ✓
- Backward flows (loops) ✓
- Data objects near associated elements ✓
- Text annotations near associated elements ✓

## Line Count Audit

| Area                   | Lines | Phase 0 | Reduction |
| ---------------------- | ----- | ------- | --------- |
| `src/elk/`             | 6,020 | 13,010  | -54%      |
| `src/handlers/layout/` | 2,223 | —       | —         |
| `src/constants.ts`     | 360   | —       | —         |
| Layout source total    | 8,603 | —       | —         |
| Layout tests           | 8,361 | 15,329  | -45%      |

The aspirational targets from the planning phase (≤2,000 lines for elk/,
≤3,000 for tests) were not fully reached, but significant reduction was
achieved. The remaining code is well-structured with clear responsibilities.

## Consequences

- Layout quality is professional and clean for all standard BPMN patterns
- Performance is fast (<1s for typical diagrams)
- The pipeline is understandable (8 steps vs 30)
- Edge routing is handled by battle-tested bpmn-js ManhattanLayout
- Future layout improvements can focus on ELK configuration rather than
  custom post-processing
