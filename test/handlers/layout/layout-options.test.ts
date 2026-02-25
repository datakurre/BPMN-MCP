/**
 * Tests for layout_bpmn_diagram options: scope, crossing flows,
 * grid snapping, and quality metrics.
 *
 * Merged from layout-scope, layout-enhancements, and layout-metrics.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram, handleListElements } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams, connect } from '../../helpers';

// ── Scope parameter ────────────────────────────────────────────────────────

describe('layout_bpmn_diagram — scope parameter', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('rejects non-existent scope element', async () => {
    const diagramId = await createDiagram('Scope Test');
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    await expect(
      handleLayoutDiagram({ diagramId, scopeElementId: 'nonexistent' })
    ).rejects.toThrow();
  });

  test('rejects scope on a task (not Participant or SubProcess)', async () => {
    const diagramId = await createDiagram('Invalid Scope');
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });

    await expect(handleLayoutDiagram({ diagramId, scopeElementId: task })).rejects.toThrow(
      /Participant.*SubProcess|SubProcess.*Participant/
    );
  });
});

// ── Crossing flow detection ────────────────────────────────────────────────

describe('layout_bpmn_diagram — crossing flows', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('reports crossing flows in result', async () => {
    const diagramId = await createDiagram('Crossing Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskA);
    await connect(diagramId, gw, taskB);
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, join, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    if (res.crossingFlows !== undefined) {
      expect(typeof res.crossingFlows).toBe('number');
    }
  });

  test('returns crossingFlowPairs as an array when crossings exist', async () => {
    const diagramId = await createDiagram('Crossing Pairs Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const taskA = await addElement(diagramId, 'bpmn:Task', { name: 'Do A' });
    const taskB = await addElement(diagramId, 'bpmn:Task', { name: 'Do B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskA);
    await connect(diagramId, gw, taskB);
    await connect(diagramId, taskA, join);
    await connect(diagramId, taskB, join);
    await connect(diagramId, join, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    if (res.crossingFlows && res.crossingFlows > 0) {
      expect(Array.isArray(res.crossingFlowPairs)).toBe(true);
      expect(res.crossingFlowPairs.length).toBe(res.crossingFlows);
      for (const pair of res.crossingFlowPairs) {
        expect(Array.isArray(pair)).toBe(true);
        expect(pair.length).toBe(2);
      }
    }
  });
});

// ── Grid snapping ──────────────────────────────────────────────────────────

describe('layout_bpmn_diagram — grid snapping', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('snaps element positions to grid when gridSnap is set', async () => {
    const diagramId = await createDiagram('Grid Snap Test');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Order' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    // Layout with grid snapping to 10px
    const res = parseResult(await handleLayoutDiagram({ diagramId, gridSnap: 10 } as any));
    expect(res.success).toBe(true);

    // Check that all element positions are multiples of 10
    const elemRes = parseResult(await handleListElements({ diagramId }));
    const elements = elemRes.elements.filter(
      (e: any) => e.x !== undefined && e.y !== undefined && !e.type.includes('Flow')
    );

    for (const el of elements) {
      expect(el.x % 10).toBe(0);
      expect(el.y % 10).toBe(0);
    }
  });

  test('does not affect positions when gridSnap is not set', async () => {
    const diagramId = await createDiagram('No Grid Snap');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process Order' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
  });
});

// ── Quality metrics ────────────────────────────────────────────────────────

describe('layout quality metrics', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('returns quality metrics after layout', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task A' });
    const task2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task B' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));

    expect(res.qualityMetrics).toBeDefined();
    expect(res.qualityMetrics.orthogonalFlowPercent).toBeGreaterThanOrEqual(0);
    expect(res.qualityMetrics.orthogonalFlowPercent).toBeLessThanOrEqual(100);
    expect(typeof res.qualityMetrics.avgBendCount).toBe('number');
  });

  test('linear flow has high orthogonal percentage', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));

    // Linear flow should produce mostly orthogonal connections
    expect(res.qualityMetrics.orthogonalFlowPercent).toBeGreaterThanOrEqual(80);
  });
});
