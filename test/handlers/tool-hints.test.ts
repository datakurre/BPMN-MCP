/**
 * Tests for tool-discovery hints and naming convention hints.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { createDiagram, parseResult, clearDiagrams } from '../helpers';
import { handleAddElement } from '../../src/handlers/add-element';
import { handleConnect } from '../../src/handlers/connect';
import { handleCreateCollaboration } from '../../src/handlers/create-collaboration';
import { handleSetLoopCharacteristics } from '../../src/handlers/set-loop-characteristics';
import { handleSetProperties } from '../../src/handlers/set-properties';
import { handleInsertElement } from '../../src/handlers/insert-element';
import { handleListElements } from '../../src/handlers/list-elements';

afterEach(() => clearDiagrams());

/** Helper to add an element and return the full parsed result. */
async function addEl(diagramId: string, type: string, name?: string) {
  return parseResult(await handleAddElement({ diagramId, elementType: type, name }));
}

describe('connect_bpmn_elements layout hint', () => {
  test('includes layout nextSteps hint in pair mode', async () => {
    const diagramId = await createDiagram();
    const start = (await addEl(diagramId, 'bpmn:StartEvent', 'Start')).elementId;
    const task = (await addEl(diagramId, 'bpmn:UserTask', 'Do Work')).elementId;

    const result = parseResult(
      await handleConnect({ diagramId, sourceElementId: start, targetElementId: task })
    );

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.tool === 'layout_bpmn_diagram')).toBe(true);
  });

  test('includes layout nextSteps hint in chain mode', async () => {
    const diagramId = await createDiagram();
    const start = (await addEl(diagramId, 'bpmn:StartEvent', 'Start')).elementId;
    const task = (await addEl(diagramId, 'bpmn:UserTask', 'Do Work')).elementId;
    const end = (await addEl(diagramId, 'bpmn:EndEvent', 'End')).elementId;

    const result = parseResult(await handleConnect({ diagramId, elementIds: [start, task, end] }));

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.tool === 'layout_bpmn_diagram')).toBe(true);
  });
});

describe('insert_bpmn_element hints', () => {
  test('includes layout and type-specific hints after insertion', async () => {
    const diagramId = await createDiagram();
    const start = (await addEl(diagramId, 'bpmn:StartEvent', 'Start')).elementId;
    const end = (await addEl(diagramId, 'bpmn:EndEvent', 'End')).elementId;
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: end });

    // Get the flow ID
    const elements = parseResult(await handleListElements({ diagramId }));
    const flow = elements.elements.find((e: any) => e.type === 'bpmn:SequenceFlow');

    const result = parseResult(
      await handleInsertElement({
        diagramId,
        flowId: flow.id,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Order',
      })
    );

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.tool === 'layout_bpmn_diagram')).toBe(true);
    // ServiceTask should get set_bpmn_element_properties hint
    expect(result.nextSteps.some((h: any) => h.tool === 'set_bpmn_element_properties')).toBe(true);
  });
});

describe('gateway hints', () => {
  test('includes naming convention hint for exclusive gateway', async () => {
    const diagramId = await createDiagram();
    const result = await addEl(diagramId, 'bpmn:ExclusiveGateway');

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.tool === 'set_bpmn_element_properties')).toBe(true);
    // Should include naming hint since no name was provided
    expect(result.namingHint).toBeDefined();
    expect(result.namingHint).toContain('?');
  });

  test('does not include naming hint when name is provided', async () => {
    const diagramId = await createDiagram();
    const result = await addEl(diagramId, 'bpmn:ExclusiveGateway', 'Order valid?');

    expect(result.namingHint).toBeUndefined();
  });
});

describe('collaboration pattern guidance', () => {
  test('includes nextSteps hints after creating collaboration', async () => {
    const diagramId = await createDiagram();

    const result = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Order Process' }, { name: 'Payment Provider', collapsed: true }],
      })
    );

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.tool === 'add_bpmn_element')).toBe(true);
    expect(result.nextSteps.some((h: any) => h.tool === 'connect_bpmn_elements')).toBe(true);
  });
});

describe('multi-instance hint', () => {
  test('suggests elementVariable when collection is set without it', async () => {
    const diagramId = await createDiagram();
    const taskId = (await addEl(diagramId, 'bpmn:UserTask', 'Review Items')).elementId;

    const result = parseResult(
      await handleSetLoopCharacteristics({
        diagramId,
        elementId: taskId,
        loopType: 'parallel',
        collection: 'items',
      })
    );

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.description.includes('elementVariable'))).toBe(true);
  });

  test('does not suggest elementVariable when already set', async () => {
    const diagramId = await createDiagram();
    const taskId = (await addEl(diagramId, 'bpmn:UserTask', 'Review Items')).elementId;

    const result = parseResult(
      await handleSetLoopCharacteristics({
        diagramId,
        elementId: taskId,
        loopType: 'parallel',
        collection: 'items',
        elementVariable: 'item',
      })
    );

    if (result.nextSteps) {
      expect(result.nextSteps.some((h: any) => h.description.includes('elementVariable'))).toBe(
        false
      );
    }
  });
});

describe('event subprocess guidance', () => {
  test('hints about start event when triggeredByEvent is set', async () => {
    const diagramId = await createDiagram();
    const subId = (await addEl(diagramId, 'bpmn:SubProcess', 'Error Handler')).elementId;

    const result = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: subId,
        properties: { triggeredByEvent: true, isExpanded: true },
      })
    );

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.description.includes('start event'))).toBe(true);
  });
});

describe('external task hint', () => {
  test('suggests asyncBefore when setting camunda:topic', async () => {
    const diagramId = await createDiagram();
    const taskId = (await addEl(diagramId, 'bpmn:ServiceTask', 'External Work')).elementId;

    const result = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: { 'camunda:topic': 'my-topic' },
      })
    );

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((h: any) => h.description.includes('asyncBefore'))).toBe(true);
  });
});
