/**
 * Shared helpers for acceptance (multi-step story) tests.
 *
 * The `assertStep` function verifies element existence, properties,
 * and lint errors against the current diagram state.
 */

import { expect } from 'vitest';
import { handleListElements, handleValidate } from '../../src/handlers';

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

export interface StepChecks {
  /** Element names that must appear in the diagram. */
  containsElements?: string[];
  /** Maximum number of lint error-level issues (default: not checked). */
  lintErrorCount?: number;
}

/**
 * Assert a set of checks against the current diagram state.
 *
 * @param diagramId  The diagram to inspect.
 * @param stepName   Human-readable label used in failure messages.
 * @param checks     The checks to run.
 */
export async function assertStep(
  diagramId: string,
  stepName: string,
  checks: StepChecks
): Promise<void> {
  // ── Element-name checks ──────────────────────────────────────────────────
  if (checks.containsElements && checks.containsElements.length > 0) {
    const listRes = parseResult(await handleListElements({ diagramId }));
    const names = new Set<string>(
      (listRes.elements as any[]).map((e: any) => e.name).filter(Boolean)
    );
    for (const expectedName of checks.containsElements) {
      expect(names, `${stepName}: diagram should contain element "${expectedName}"`).toContain(
        expectedName
      );
    }
  }

  // ── Lint error count ─────────────────────────────────────────────────────
  if (checks.lintErrorCount !== undefined) {
    const lintRes = parseResult(await handleValidate({ diagramId }));
    const errors = ((lintRes.issues ?? []) as any[]).filter((i: any) => i.severity === 'error');
    expect(
      errors.length,
      `${stepName}: expected ${checks.lintErrorCount} lint error(s) but got ${errors.length}: ${errors.map((e: any) => `${e.elementId}: ${e.message} [${e.rule}]`).join(', ')}`
    ).toBe(checks.lintErrorCount);
  }
}

/** Find an element in the diagram by name. Returns undefined if not found. */
export async function findElementByName(diagramId: string, name: string): Promise<any | undefined> {
  const listRes = parseResult(await handleListElements({ diagramId }));
  return (listRes.elements as any[]).find((e: any) => e.name === name);
}

/** Find a sequence flow between two elements by their IDs. */
export async function findFlowBetween(
  diagramId: string,
  sourceId: string,
  targetId: string
): Promise<any | undefined> {
  const listRes = parseResult(await handleListElements({ diagramId }));
  // list-elements returns sourceId/targetId (not source.id/target.id)
  return (listRes.elements as any[]).find(
    (e: any) =>
      e.type === 'bpmn:SequenceFlow' &&
      (e.sourceId ?? e.source?.id) === sourceId &&
      (e.targetId ?? e.target?.id) === targetId
  );
}

/** Parse the JSON result from any handler call. */
export { parseResult };
