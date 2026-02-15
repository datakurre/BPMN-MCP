/**
 * Tests for summarize_bpmn_diagram tool.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleSummarizeDiagram } from '../../../src/handlers/core/summarize-diagram';
import { handleSetProperties } from '../../../src/handlers';
import { clearDiagrams } from '../../../src/diagram-manager';
import { parseResult, createDiagram, addElement, connect } from '../../helpers';

afterEach(() => clearDiagrams());

describe('summarize_bpmn_diagram', () => {
  test('should return a summary of the diagram', async () => {
    const diagramId = await createDiagram('summary-test');

    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process' });
    await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const summary = parseResult(await handleSummarizeDiagram({ diagramId }));
    expect(summary.success).toBe(true);
    expect(summary.totalElements).toBeGreaterThanOrEqual(4);
    expect(summary.flowElementCount).toBeGreaterThanOrEqual(4);
    expect(summary.namedElements).toBeDefined();
    expect(summary.namedElements.length).toBeGreaterThanOrEqual(4);
    expect(summary.elementCounts['bpmn:UserTask']).toBe(1);
    expect(summary.elementCounts['bpmn:ServiceTask']).toBe(1);
  });

  test('should report disconnected elements', async () => {
    const diagramId = await createDiagram('summary-disconnected');

    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Orphan', x: 500, y: 100 });

    const summary = parseResult(await handleSummarizeDiagram({ diagramId }));
    expect(summary.disconnectedCount).toBeGreaterThanOrEqual(1);
  });

  test('suggests lanes when multiple assignees exist without lanes', async () => {
    const diagramId = await createDiagram('summary-lanes-hint');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Submit' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const task3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, task3);
    await connect(diagramId, task3, end);

    // Assign different roles
    await handleSetProperties({
      diagramId,
      elementId: task1,
      properties: { 'camunda:assignee': 'requester' },
    });
    await handleSetProperties({
      diagramId,
      elementId: task2,
      properties: { 'camunda:assignee': 'reviewer' },
    });
    await handleSetProperties({
      diagramId,
      elementId: task3,
      properties: { 'camunda:assignee': 'manager' },
    });

    const summary = parseResult(await handleSummarizeDiagram({ diagramId }));
    expect(summary.structureRecommendation).toBeDefined();
    expect(summary.structureRecommendation).toContain('assignees');
    expect(summary.structureRecommendation).toContain('analyze_bpmn_lanes');
  });
});
