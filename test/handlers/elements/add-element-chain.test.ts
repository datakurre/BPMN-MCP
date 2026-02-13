import { describe, test, expect, beforeEach } from 'vitest';
import { handleAddElementChain } from '../../../src/handlers';
import { createDiagram, parseResult, addElement, clearDiagrams } from '../../helpers';

describe('add_bpmn_element_chain', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a linear chain of elements', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Review' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(3);
    expect(res.elementIds).toHaveLength(3);
    // First element has no connection (no afterElementId), subsequent ones do
    expect(res.elements[0].connectionId).toBeUndefined();
    expect(res.elements[1].connectionId).toBeDefined();
    expect(res.elements[2].connectionId).toBeDefined();
  });

  test('connects chain after an existing element', async () => {
    const diagramId = await createDiagram();
    const startId = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        afterElementId: startId,
        elements: [
          { elementType: 'bpmn:UserTask', name: 'Task 1' },
          { elementType: 'bpmn:UserTask', name: 'Task 2' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(3);
    // First element should be connected to afterElement
    expect(res.elements[0].connectionId).toBeDefined();
    expect(res.elements[1].connectionId).toBeDefined();
    expect(res.elements[2].connectionId).toBeDefined();
  });

  test('rejects empty elements array', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleAddElementChain({
        diagramId,
        elements: [],
      })
    ).rejects.toThrow(/Missing required/);
  });

  test('rejects invalid element type', async () => {
    const diagramId = await createDiagram();

    await expect(
      handleAddElementChain({
        diagramId,
        elements: [{ elementType: 'bpmn:Participant' }],
      })
    ).rejects.toThrow();
  });

  test('creates single element chain', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [{ elementType: 'bpmn:UserTask', name: 'Solo Task' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.elementCount).toBe(1);
    expect(res.elementIds).toHaveLength(1);
  });

  test('includes element names in message', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Begin' },
          { elementType: 'bpmn:ServiceTask', name: 'Process' },
          { elementType: 'bpmn:EndEvent', name: 'Done' },
        ],
      })
    );

    expect(res.message).toContain('Begin');
    expect(res.message).toContain('Process');
    expect(res.message).toContain('Done');
  });

  test('validates all element types before creating any', async () => {
    const diagramId = await createDiagram();

    // Second element has invalid type - should fail before creating first
    await expect(
      handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:InvalidType' as any, name: 'Bad' },
        ],
      })
    ).rejects.toThrow();
  });
});
