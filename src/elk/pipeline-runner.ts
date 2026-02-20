/**
 * PipelineRunner: sequential executor for ELK layout pipeline steps (B1-3).
 *
 * Provides a declarative, testable interface for running an ordered list of
 * {@link PipelineStep} objects.  Each step is:
 *  - Logged via {@link LayoutLogger} with timing and optional delta metrics.
 *  - Optionally skipped when its `skip` predicate returns `true`.
 *  - Optionally delta-tracked when `trackDelta` is set and delta callbacks
 *    are supplied to the constructor.
 *  - Wrapped in structured error handling (B1-7): errors are re-thrown with
 *    the failing step name prepended for easier diagnosis.
 *
 * ### Usage
 * ```typescript
 * const runner = new PipelineRunner(steps, log, { snap, count });
 * await runner.run(ctx);
 * ```
 *
 * ### Nested sub-pipelines (B1-5)
 * Steps that contain sub-pipelines (e.g. `repairAndSimplifyEdges`) create a
 * child `PipelineRunner` inside their `run` function, sharing the same logger
 * from `ctx.log`.  This allows sub-steps to be individually logged and
 * introspected without leaking the runner instance into the parent scope.
 *
 * ### Testability (B1-8)
 * `getStepNames()` returns the ordered list of step names, enabling tests to
 * assert that the pipeline steps are in the required dependency order without
 * executing any BPMN operations.
 */

import type { LayoutContext, PipelineStep } from './types';
import type { LayoutLogger, PositionSnapshot } from './layout-logger';

/** Callbacks for position-delta tracking across pipeline steps. */
export interface DeltaCallbacks {
  /** Snapshot element positions before each tracked step. */
  snap: () => PositionSnapshot;
  /** Count how many elements moved since the given snapshot. */
  count: (before: PositionSnapshot) => number;
}

/**
 * Sequential executor for an ordered list of {@link PipelineStep} objects.
 *
 * Steps are executed in array order.  Steps whose `skip` predicate returns
 * `true` for the current context are silently bypassed.  Every executed step
 * is wrapped with `LayoutLogger.stepAsync()` (or `stepAsyncWithDelta()` for
 * delta-tracked steps), providing consistent timing and debug logging.
 *
 * Error handling (B1-7): if a step's `run` function throws, the error is
 * caught, wrapped with a `Pipeline step "<name>" failed: <message>` prefix,
 * and re-thrown so the caller can distinguish layout failures by step name.
 */
export class PipelineRunner {
  /** The ordered steps this runner will execute. Exposed for B1-8 ordering tests. */
  readonly steps: readonly PipelineStep[];

  private readonly log: LayoutLogger;
  private readonly delta: DeltaCallbacks | undefined;

  /**
   * @param steps  Ordered list of pipeline steps.
   * @param log    Logger instance for step timing / debug output.
   * @param delta  Optional delta-tracking callbacks (snap + count).
   *               When provided, steps with `trackDelta: true` report how
   *               many elements moved during the step.
   */
  constructor(steps: PipelineStep[], log: LayoutLogger, delta?: DeltaCallbacks) {
    this.steps = steps;
    this.log = log;
    this.delta = delta;
  }

  /**
   * Execute all steps in order against the given context.
   *
   * Steps whose `skip(ctx)` predicate returns `true` are bypassed.
   * Each step is wrapped with `LayoutLogger.stepAsync[WithDelta]` for
   * consistent timing and optional delta metrics.
   *
   * B1-7: Each step is wrapped in try/catch.  On failure the error is
   * re-thrown as a new `Error` with the step name prepended, preserving
   * the original error as `cause` for full stack trace access.
   */
  async run(ctx: LayoutContext): Promise<void> {
    for (const step of this.steps) {
      if (step.skip?.(ctx)) continue;

      try {
        const hasDelta =
          step.trackDelta &&
          this.delta !== undefined &&
          this.delta.snap !== undefined &&
          this.delta.count !== undefined;

        if (hasDelta) {
          // stepAsyncWithDelta snapshots before, awaits step, then counts moved elements
          await this.log.stepAsyncWithDelta(
            step.name,
            async () => {
              await step.run(ctx);
            },
            this.delta!.snap,
            this.delta!.count
          );
        } else {
          await this.log.stepAsync(step.name, async () => {
            await step.run(ctx);
          });
        }
      } catch (err) {
        // B1-7: Structured error reporting — step name is prepended so the
        // caller immediately knows which pipeline step failed.
        const msg = err instanceof Error ? err.message : String(err);
        const cause = err instanceof Error ? err : new Error(String(err));
        throw new Error(`Pipeline step "${step.name}" failed: ${msg}`, { cause });
      }
    }
  }

  /**
   * Return the names of all steps in their execution order.
   *
   * Used by pipeline-ordering tests (B1-8) to assert that dependency-critical
   * steps are declared in the correct sequence without running any BPMN ops.
   */
  getStepNames(): string[] {
    return this.steps.map((s) => s.name);
  }
}
