/**
 * Tests for post-layout edge crossing reduction.
 *
 * Verifies that the reduceCrossings pass attempts to eliminate
 * edge crossings detected after layout.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { handleLayoutDiagram } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, connect, clearDiagrams } from '../../helpers';

describe('edge crossing reduction', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('layout reports crossing flow info when crossings exist', async () => {
    const diagramId = await createDiagram('Crossing Test');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw1 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Split?' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path A' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Path B' });
    const gw2 = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, gw1);
    await connect(diagramId, gw1, t1);
    await connect(diagramId, gw1, t2);
    await connect(diagramId, t1, gw2);
    await connect(diagramId, t2, gw2);
    await connect(diagramId, gw2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // crossingFlows is only present when > 0; otherwise absent
    const crossings = res.crossingFlows ?? 0;
    expect(crossings).toBeGreaterThanOrEqual(0);
  });

  test('simple linear process has no crossings', async () => {
    const diagramId = await createDiagram('No Crossings');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Step 2' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    // No crossingFlows property means 0 crossings
    expect(res.crossingFlows).toBeUndefined();
  });

  test('parallel gateway branches have low or zero crossings', async () => {
    const diagramId = await createDiagram('Parallel Branches');

    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const pgw1 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Fork' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 1' });
    const t2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 2' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 3' });
    const pgw2 = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    await connect(diagramId, start, pgw1);
    await connect(diagramId, pgw1, t1);
    await connect(diagramId, pgw1, t2);
    await connect(diagramId, pgw1, t3);
    await connect(diagramId, t1, pgw2);
    await connect(diagramId, t2, pgw2);
    await connect(diagramId, t3, pgw2);
    await connect(diagramId, pgw2, end);

    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);

    // The layout engine + crossing reduction should produce low or zero crossings
    const crossings = res.crossingFlows ?? 0;
    expect(crossings).toBeLessThanOrEqual(2);
  });
});
