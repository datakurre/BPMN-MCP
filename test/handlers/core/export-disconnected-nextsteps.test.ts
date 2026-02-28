/**
 * Tests that export_bpmn with disconnected elements appends a structured
 * `nextSteps` suggestion (including `connect_bpmn_elements` tool call)
 * in addition to the plain text connectivity warning.
 *
 * Regression: before this fix, the hint only said "Use connect_bpmn_elements
 * to add flows" as plain text, without a structured JSON nextSteps payload
 * that an AI agent could execute directly.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { handleExportBpmn } from '../../../src/handlers';
import { createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('export_bpmn — disconnected element nextSteps suggestion', () => {
  beforeEach(() => clearDiagrams());

  test('export includes structured connect_bpmn_elements suggestion for disconnected EndEvent', async () => {
    const diagramId = await createDiagram();

    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 150,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      x: 320,
      y: 200,
    });
    // EndEvent intentionally left disconnected
    const _endId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done', x: 500, y: 200 });

    // Connect start → task, but leave task → end disconnected
    await connect(diagramId, startId, taskId);

    // Export with skipLint (so lint gate doesn't block)
    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });

    const allText = exportRes.content.map((c: any) => c.text).join('\n');

    // Must mention connect_bpmn_elements
    expect(allText).toContain('connect_bpmn_elements');

    // Must name the disconnected element
    expect(allText).toContain(_endId);
  });

  test('export includes nextSteps JSON block with connect call when elements are disconnected', async () => {
    const diagramId = await createDiagram();

    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 150,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Do Work',
      x: 320,
      y: 200,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done', x: 500, y: 200 });

    // Connect start → task, task → end are missing
    await connect(diagramId, startId, taskId);

    const exportRes = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });

    // Look for a JSON nextSteps block in the content
    const allText = exportRes.content.map((c: any) => c.text).join('\n');

    // Should include a "nextSteps" JSON structure with connect_bpmn_elements
    expect(allText).toContain('"connect_bpmn_elements"');
    expect(allText).toContain(endId);
  });
});
