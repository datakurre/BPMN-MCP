/**
 * Tests for add_bpmn_element's laneId, ensureUnique, and di response fields.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../utils/diagram';
import { handleAddElement } from '../../../src/handlers';

afterEach(() => clearDiagrams());

describe('add_bpmn_element — laneId parameter', () => {
  test('rejects laneId that is not a Lane', async () => {
    const diagramId = await createDiagram('lane-test');
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task1' });

    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task2',
        laneId: task,
      })
    ).rejects.toThrow(/operation requires.*bpmn:Lane/);
  });

  test('rejects laneId that does not exist', async () => {
    const diagramId = await createDiagram('lane-test');

    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task1',
        laneId: 'nonexistent_lane',
      })
    ).rejects.toThrow();
  });
});

describe('add_bpmn_element — ensureUnique flag', () => {
  test('rejects duplicate when ensureUnique is true', async () => {
    const diagramId = await createDiagram('unique-test');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    await expect(
      handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Order',
        ensureUnique: true,
      })
    ).rejects.toThrow(/ensureUnique/);
  });

  test('allows duplicate when ensureUnique is false (default)', async () => {
    const diagramId = await createDiagram('unique-test');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    // Should succeed (with a warning)
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Order',
      })
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('already exists');
  });

  test('allows same name with different type when ensureUnique is true', async () => {
    const diagramId = await createDiagram('unique-test');
    await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Order' });

    // Different type — should succeed
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Review Order',
        ensureUnique: true,
      })
    );
    expect(result.success).toBe(true);
  });

  test('allows duplicate unnamed elements even with ensureUnique', async () => {
    const diagramId = await createDiagram('unique-test');
    await addElement(diagramId, 'bpmn:UserTask');

    // No name — ensureUnique only checks named elements
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        ensureUnique: true,
      })
    );
    expect(result.success).toBe(true);
  });
});

describe('add_bpmn_element — di info in response', () => {
  test('returns di object with x, y, width, height', async () => {
    const diagramId = await createDiagram('di-test');
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'My Task',
      })
    );

    expect(result.di).toBeDefined();
    expect(result.di.x).toBeTypeOf('number');
    expect(result.di.y).toBeTypeOf('number');
    expect(result.di.width).toBeTypeOf('number');
    expect(result.di.height).toBeTypeOf('number');
    // UserTask default size is 100×80
    expect(result.di.width).toBe(100);
    expect(result.di.height).toBe(80);
  });

  test('returns correct di for start events', async () => {
    const diagramId = await createDiagram('di-test');
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
      })
    );

    expect(result.di).toBeDefined();
    // StartEvent default size is 36×36
    expect(result.di.width).toBe(36);
    expect(result.di.height).toBe(36);
  });

  test('returns correct di for gateways', async () => {
    const diagramId = await createDiagram('di-test');
    const result = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Approved?',
      })
    );

    expect(result.di).toBeDefined();
    // Gateway default size is 50×50
    expect(result.di.width).toBe(50);
    expect(result.di.height).toBe(50);
  });
});
