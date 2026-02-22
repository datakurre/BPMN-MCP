/**
 * Tests for pipeline step ordering (B1-8).
 *
 * Verifies that:
 * - `MAIN_PIPELINE_STEPS` declares all expected steps in the correct order.
 * - `PipelineRunner.getStepNames()` reflects the declared order.
 * - Steps with `trackDelta: true` are only those that move BPMN shapes.
 *
 * These assertions prevent accidental reordering of dependency-critical steps.
 * They run without any BPMN modeler or element registry — purely structural.
 */
import { describe, test, expect } from 'vitest';
import { MAIN_PIPELINE_STEPS, PipelineRunner } from '../../../src/elk/index';
import { createLayoutLogger } from '../../../src/elk/layout-logger';

// ── Expected step names ──────────────────────────────────────────────────────

/**
 * Expected main pipeline step order.
 * Derived from the dependency chain documented in index.ts and types.ts.
 * If you need to reorder steps, update this array and document WHY in a comment.
 */
const EXPECTED_MAIN_STEPS = [
  'applyNodePositions',
  'finalisePoolsAndLanes',
  'fixBoundaryEvents',
  'positionEventSubprocesses',
  'repositionArtifacts',
  'layoutAllConnections',
  'normaliseOrigin',
  'detectCrossingFlows',
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('pipeline step ordering (B1-8)', () => {
  test('MAIN_PIPELINE_STEPS has the correct step names in dependency order', () => {
    const actual = MAIN_PIPELINE_STEPS.map((s) => s.name);
    expect(actual).toEqual(EXPECTED_MAIN_STEPS);
  });

  test('PipelineRunner.getStepNames() reflects declaration order', () => {
    const log = createLayoutLogger('ordering-test');
    const runner = new PipelineRunner(MAIN_PIPELINE_STEPS as any[], log);
    expect(runner.getStepNames()).toEqual(EXPECTED_MAIN_STEPS);
  });

  test('total step count matches expected (guards against accidental addition/removal)', () => {
    expect(MAIN_PIPELINE_STEPS.length).toBe(EXPECTED_MAIN_STEPS.length);
  });

  test('node-positioning phase steps run before pool/boundary/edge phase', () => {
    const names = MAIN_PIPELINE_STEPS.map((s) => s.name);
    const applyNodeIdx = names.indexOf('applyNodePositions');
    const finalisePoolsIdx = names.indexOf('finalisePoolsAndLanes');
    const layoutConnsIdx = names.indexOf('layoutAllConnections');

    expect(applyNodeIdx).toBeLessThan(finalisePoolsIdx);
    expect(finalisePoolsIdx).toBeLessThan(layoutConnsIdx);
  });

  test('layoutAllConnections runs before normaliseOrigin', () => {
    const names = MAIN_PIPELINE_STEPS.map((s) => s.name);
    const layoutConnsIdx = names.indexOf('layoutAllConnections');
    const normaliseIdx = names.indexOf('normaliseOrigin');

    // normaliseOrigin must run AFTER layoutAllConnections (so waypoints shift together)
    expect(layoutConnsIdx).toBeLessThan(normaliseIdx);
  });

  test('detectCrossingFlows is the last step in the main pipeline', () => {
    const names = MAIN_PIPELINE_STEPS.map((s) => s.name);
    expect(names[names.length - 1]).toBe('detectCrossingFlows');
  });

  test('delta-tracked steps are the correct subset', () => {
    const deltaTracked = MAIN_PIPELINE_STEPS.filter((s) => s.trackDelta).map((s) => s.name);
    // Only steps that move shapes (not connection-only steps) should track deltas
    expect(deltaTracked).toEqual(['applyNodePositions', 'fixBoundaryEvents']);
  });
});
