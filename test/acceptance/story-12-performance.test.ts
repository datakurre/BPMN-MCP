/**
 * Story 12: Performance Comparison
 *
 * Benchmarks the ELK layout pipeline on diagrams of increasing complexity.
 * Records timings for simple (5 elements), medium (20 elements), and
 * large (50+ elements) diagrams plus a collaboration with 3 pools.
 *
 * This test is excluded from CI (vitest.config.ts tag: 'benchmark').
 * Run manually: npx vitest run test/acceptance/story-12-performance.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { handleAddElementChain, handleLayoutDiagram, handleImportXml } from '../../src/handlers';
import { clearDiagrams, createDiagram, addElement, connect } from '../helpers';
import { resolve } from 'node:path';

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

const REFERENCES_DIR = resolve(__dirname, '..', 'fixtures', 'layout-references');

describe('Story 12: Performance Comparison', () => {
  beforeEach(() => clearDiagrams());
  afterEach(() => clearDiagrams());

  test('simple diagram (5 elements): layout completes in <2s', async () => {
    const diagramId = await createDiagram('Simple');
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Task 1' },
          { elementType: 'bpmn:ServiceTask', name: 'Task 2' },
          { elementType: 'bpmn:UserTask', name: 'Task 3' },
          { elementType: 'bpmn:EndEvent', name: 'End' },
        ],
      })
    );
    expect(chainRes.success).toBe(true);

    const start = performance.now();
    await handleLayoutDiagram({ diagramId });
    const elapsed = performance.now() - start;

    console.error(`Simple diagram (5 elements): ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(2000);
  });

  test('medium diagram (20 elements): layout completes in <5s', async () => {
    const diagramId = await createDiagram('Medium');

    // Build a process with ~20 elements: chain + branches
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Task A' },
          { elementType: 'bpmn:ExclusiveGateway', name: 'GW1' },
        ],
      })
    );
    const gwId = chainRes.elementIds[2];

    // Add branches from gateway
    const branches: string[] = [];
    for (let i = 0; i < 3; i++) {
      const taskId = await addElement(diagramId, 'bpmn:UserTask', {
        name: `Branch ${i + 1}`,
        afterElementId: gwId,
      });
      branches.push(taskId);
    }

    // Add merge gateway
    const mergeGw = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Merge',
      afterElementId: branches[0],
    });
    for (let i = 1; i < branches.length; i++) {
      await connect(diagramId, branches[i], mergeGw);
    }

    // Add more tasks after merge
    const moreTasks: string[] = [mergeGw];
    for (let i = 0; i < 8; i++) {
      const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
        name: `Step ${i + 1}`,
        afterElementId: moreTasks[moreTasks.length - 1],
      });
      moreTasks.push(taskId);
    }

    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      afterElementId: moreTasks[moreTasks.length - 1],
    });

    const start = performance.now();
    await handleLayoutDiagram({ diagramId });
    const elapsed = performance.now() - start;

    console.error(`Medium diagram (~20 elements): ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(5000);
  });

  test('large diagram (50+ elements): layout completes in <10s', async () => {
    const diagramId = await createDiagram('Large');

    // Build a large process
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Start' },
          { elementType: 'bpmn:UserTask', name: 'Initial' },
          { elementType: 'bpmn:ParallelGateway', name: 'Fork' },
        ],
      })
    );
    const forkId = chainRes.elementIds[2];

    // Add 5 parallel branches with 8 tasks each = ~40 tasks + 2 gateways + 2 events = ~50
    const branchEnds: string[] = [];
    for (let b = 0; b < 5; b++) {
      let prevId = forkId;
      for (let t = 0; t < 8; t++) {
        const taskId = await addElement(diagramId, 'bpmn:ServiceTask', {
          name: `B${b + 1}-T${t + 1}`,
          afterElementId: prevId,
        });
        prevId = taskId;
      }
      branchEnds.push(prevId);
    }

    // Join gateway
    const joinGw = await addElement(diagramId, 'bpmn:ParallelGateway', {
      name: 'Join',
      afterElementId: branchEnds[0],
    });
    for (let i = 1; i < branchEnds.length; i++) {
      await connect(diagramId, branchEnds[i], joinGw);
    }

    await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'End',
      afterElementId: joinGw,
    });

    const start = performance.now();
    await handleLayoutDiagram({ diagramId });
    const elapsed = performance.now() - start;

    console.error(`Large diagram (50+ elements): ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(10000);
  });

  test('collaboration with 3 pools: layout completes in <5s', async () => {
    // Import the collaboration reference
    const filePath = resolve(REFERENCES_DIR, '05-collaboration.bpmn');
    const res = parseResult(await handleImportXml({ filePath }));
    expect(res.success).toBe(true);

    const start = performance.now();
    await handleLayoutDiagram({ diagramId: res.diagramId });
    const elapsed = performance.now() - start;

    console.error(`Collaboration diagram: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(5000);
  });
});
