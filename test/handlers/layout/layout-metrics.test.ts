/**
 * Tests for layout quality metrics and container sizing warnings.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

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
