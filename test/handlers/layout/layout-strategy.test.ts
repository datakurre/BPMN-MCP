import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import {
  parseResult,
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  getRegistry,
} from '../../helpers';

describe('layout_bpmn_diagram layoutStrategy', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('deterministic layout arranges a linear chain left-to-right', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 1' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Task 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, task1);
    await connect(diagramId, task1, task2);
    await connect(diagramId, task2, end);

    const res = parseResult(
      await handleLayoutDiagram({ diagramId, layoutStrategy: 'deterministic' })
    );

    expect(res.success).toBe(true);
    expect(res.layoutStrategy).toBe('deterministic');

    // Elements should be arranged left-to-right
    const registry = getRegistry(diagramId);
    const startEl = registry.get(start);
    const task1El = registry.get(task1);
    const task2El = registry.get(task2);
    const endEl = registry.get(end);

    expect(task1El.x).toBeGreaterThan(startEl.x);
    expect(task2El.x).toBeGreaterThan(task1El.x);
    expect(endEl.x).toBeGreaterThan(task2El.x);

    // All should share approximately the same Y (linear chain)
    const ys = [startEl.y, task1El.y, task2El.y, endEl.y];
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    for (const y of ys) {
      expect(Math.abs(y - avgY)).toBeLessThan(50);
    }
  });

  test('deterministic layout falls back to full for complex diagrams', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw1 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW1' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T1' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T2' });
    const gw2 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW2' });
    const task3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'T3' });
    const gw3 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'GW3' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, gw1);
    await connect(diagramId, gw1, task1);
    await connect(diagramId, gw1, task2);
    await connect(diagramId, task1, gw2);
    await connect(diagramId, task2, gw2);
    await connect(diagramId, gw2, task3);
    await connect(diagramId, task3, gw3);
    await connect(diagramId, gw3, gw1); // loop back - makes it non-trivial
    await connect(diagramId, gw3, end);

    const res = parseResult(
      await handleLayoutDiagram({ diagramId, layoutStrategy: 'deterministic' })
    );

    expect(res.success).toBe(true);
    // Should fall back to full ELK, no deterministic flag
    expect(res.layoutStrategy).toBeUndefined();
  });

  test('laneStrategy parameter is accepted', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });

    const res = parseResult(await handleLayoutDiagram({ diagramId, laneStrategy: 'preserve' }));
    expect(res.success).toBe(true);
  });

  // ── C4(a): chain with one boundary event ─────────────────────────────────

  test('C4(a): deterministic layout works for a chain with a boundary event', async () => {
    // Diagram: Start → Task (with error boundary event) → End
    // The boundary event and its exception path should be excluded from the
    // trivial-chain detection, leaving a clean chain that deterministic layout handles.
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Do Task' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });
    await connect(diagramId, start, task);
    await connect(diagramId, task, end);

    // Add a boundary error event on the task
    const be = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: task,
    });
    const errorHandler = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Error End' });
    await connect(diagramId, be, errorHandler);

    const res = parseResult(
      await handleLayoutDiagram({ diagramId, layoutStrategy: 'deterministic' })
    );

    expect(res.success).toBe(true);
    // Should use deterministic layout (the main chain is still trivial)
    expect(res.layoutStrategy).toBe('deterministic');

    // Main chain should be arranged left-to-right
    const registry = getRegistry(diagramId);
    const startEl = registry.get(start);
    const taskEl = registry.get(task);
    const endEl = registry.get(end);

    expect(taskEl.x).toBeGreaterThan(startEl.x);
    expect(endEl.x).toBeGreaterThan(taskEl.x);

    // All main-chain elements should share the same Y
    const ys = [startEl.y, taskEl.y, endEl.y];
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    for (const y of ys) {
      expect(Math.abs(y - avgY)).toBeLessThan(50);
    }
  });

  // ── C4(b): chain ending in parallel gateway merge ─────────────────────────

  test('C4(b): deterministic layout works for parallel gateway split-merge', async () => {
    // Diagram: Start → ParallelGateway (fork) → Task1 → ParallelGateway (join) → End
    //                                         → Task2 → /
    // detectSingleSplitMerge should recognise this as a trivial pattern.
    // The fork gateway must NOT appear in the prefix list (C4(b) prefix bug fix):
    // otherwise it gets moved twice — first as a prefix element, then as forkGateway.
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const fork = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const task1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch A' });
    const task2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch B' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, fork);
    await connect(diagramId, fork, task1);
    await connect(diagramId, fork, task2);
    await connect(diagramId, task1, join);
    await connect(diagramId, task2, join);
    await connect(diagramId, join, end);

    const res = parseResult(
      await handleLayoutDiagram({ diagramId, layoutStrategy: 'deterministic' })
    );

    expect(res.success).toBe(true);
    // Should use deterministic layout (the single split-merge is a trivial pattern)
    expect(res.layoutStrategy).toBe('deterministic');

    const registry = getRegistry(diagramId);
    const startEl = registry.get(start);
    const forkEl = registry.get(fork);
    const task1El = registry.get(task1);
    const task2El = registry.get(task2);
    const joinEl = registry.get(join);
    const endEl = registry.get(end);

    // Start → Fork → [branches] → Join → End should be strictly left-to-right
    expect(forkEl.x).toBeGreaterThan(startEl.x);
    expect(joinEl.x).toBeGreaterThan(forkEl.x);
    expect(endEl.x).toBeGreaterThan(joinEl.x);

    // Branch tasks should be to the right of the fork and to the left of the join
    expect(task1El.x).toBeGreaterThan(forkEl.x);
    expect(task2El.x).toBeGreaterThan(forkEl.x);
    expect(task1El.x).toBeLessThan(joinEl.x);
    expect(task2El.x).toBeLessThan(joinEl.x);

    // Fork and join gateways (and start/end events) should be on the same Y as the main path.
    // Branch tasks may be above/below each other but fork/join should share ~same Y.
    const mainY = startEl.y + (startEl.height || 36) / 2; // centre Y of start
    const forkCy = forkEl.y + (forkEl.height || 50) / 2;
    const joinCy = joinEl.y + (joinEl.height || 50) / 2;
    expect(Math.abs(forkCy - mainY)).toBeLessThan(50);
    expect(Math.abs(joinCy - mainY)).toBeLessThan(50);

    // The fork gateway must NOT have been positioned to the right of itself
    // (which would indicate the C4(b) double-move bug). The fork should be
    // closer to the start than the join.
    const forkCx = forkEl.x + (forkEl.width || 50) / 2;
    const joinCx = joinEl.x + (joinEl.width || 50) / 2;
    const startCx = startEl.x + (startEl.width || 36) / 2;
    const endCx = endEl.x + (endEl.width || 36) / 2;
    expect(forkCx - startCx).toBeLessThan(joinCx - startCx); // fork before join
    expect(joinCx - startCx).toBeLessThan(endCx - startCx); // join before end
  });

  // ── C4(c): chain with intermediate events ──────────────────────────────────

  test('C4(c): deterministic layout works for a chain with intermediate events', async () => {
    // Diagram: Start → IntermediateCatchEvent → Task → IntermediateThrowEvent → End
    // Intermediate events connect via sequence flows and should be treated like tasks.
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const timer = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', { name: 'Wait' });
    const task = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review' });
    const signal = await addElement(diagramId, 'bpmn:IntermediateThrowEvent', { name: 'Notify' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, timer);
    await connect(diagramId, timer, task);
    await connect(diagramId, task, signal);
    await connect(diagramId, signal, end);

    const res = parseResult(
      await handleLayoutDiagram({ diagramId, layoutStrategy: 'deterministic' })
    );

    expect(res.success).toBe(true);
    expect(res.layoutStrategy).toBe('deterministic');

    // Elements should be arranged left-to-right
    const registry = getRegistry(diagramId);
    const startEl = registry.get(start);
    const timerEl = registry.get(timer);
    const taskEl = registry.get(task);
    const signalEl = registry.get(signal);
    const endEl = registry.get(end);

    expect(timerEl.x).toBeGreaterThan(startEl.x);
    expect(taskEl.x).toBeGreaterThan(timerEl.x);
    expect(signalEl.x).toBeGreaterThan(taskEl.x);
    expect(endEl.x).toBeGreaterThan(signalEl.x);

    // All elements should share approximately the same Y
    const ys = [startEl.y, timerEl.y, taskEl.y, signalEl.y, endEl.y];
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    for (const y of ys) {
      expect(Math.abs(y - avgY)).toBeLessThan(50);
    }
  });
});
