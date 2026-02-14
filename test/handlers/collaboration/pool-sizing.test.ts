/**
 * Tests for pool and lane sizing improvements.
 *
 * Covers:
 * - Dynamic pool width based on element count
 * - Lane height auto-adjust based on lane count
 * - calculateOptimalPoolSize utility
 * - Pool auto-expand to fit 10+ elements
 * - Lane accommodation of all assigned elements
 * - Layout detection of pool truncation
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleCreateCollaboration,
  handleAddElement,
  handleLayoutDiagram,
  handleAutosizePoolsAndLanes,
  handleCreateLanes,
} from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams, connect } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';
import { calculateOptimalPoolSize } from '../../../src/constants';

describe('calculateOptimalPoolSize utility', () => {
  test('returns minimum 1200px width with no elements', () => {
    const size = calculateOptimalPoolSize(0, 0);
    expect(size.width).toBeGreaterThanOrEqual(1200);
  });

  test('scales width with element count', () => {
    const small = calculateOptimalPoolSize(5, 0);
    const large = calculateOptimalPoolSize(15, 0);
    expect(large.width).toBeGreaterThan(small.width);
  });

  test('scales height with lane count', () => {
    const twoLanes = calculateOptimalPoolSize(0, 2);
    const fiveLanes = calculateOptimalPoolSize(0, 5);
    expect(fiveLanes.height).toBeGreaterThan(twoLanes.height);
  });

  test('returns minimum 250px height', () => {
    const size = calculateOptimalPoolSize(0, 0);
    expect(size.height).toBeGreaterThanOrEqual(250);
  });

  test('accounts for nesting depth', () => {
    const flat = calculateOptimalPoolSize(10, 0, 0);
    const nested = calculateOptimalPoolSize(10, 0, 2);
    expect(nested.width).toBeGreaterThan(flat.width);
  });

  test('returns round numbers (multiples of 10)', () => {
    const size = calculateOptimalPoolSize(7, 3, 1);
    expect(size.width % 10).toBe(0);
    expect(size.height % 10).toBe(0);
  });
});

describe('dynamic pool width on creation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('pool with lanes gets wider default width than 600px', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          {
            name: 'HR Department',
            lanes: [{ name: 'Recruiter' }, { name: 'Manager' }, { name: 'Admin' }],
          },
          { name: 'Candidate', collapsed: true },
        ],
      })
    );

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const pool = reg.get(collab.participantIds[0]);

    // Pool with 3 lanes should be wider than the old default of 600
    expect(pool.width).toBeGreaterThan(600);
  });

  test('pool with lanes gets taller to fit all lanes', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          {
            name: 'Process',
            lanes: [{ name: 'Lane 1' }, { name: 'Lane 2' }, { name: 'Lane 3' }, { name: 'Lane 4' }],
          },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const pool = reg.get(collab.participantIds[0]);

    // 4 lanes × 150px = 600px minimum, should be taller than default 250
    expect(pool.height).toBeGreaterThanOrEqual(600);
  });

  test('explicit width overrides dynamic default', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          {
            name: 'Process',
            width: 800,
            lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
          },
          { name: 'External', collapsed: true },
        ],
      })
    );

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const pool = reg.get(collab.participantIds[0]);

    expect(pool.width).toBe(800);
  });
});

describe('pool with 10+ elements auto-expand', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('autosize expands pool to fit 10+ elements', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', width: 600, height: 250 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    // Add 12 elements spread across a wide area
    // bpmn-js auto-expands the pool as elements are added
    const elementIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const res = parseResult(
        await handleAddElement({
          diagramId,
          elementType: 'bpmn:UserTask',
          name: `Task ${i + 1}`,
          participantId: poolId,
          x: 200 + i * 160,
          y: 200,
        })
      );
      elementIds.push(res.elementId);
    }

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;

    // Simulate a manually undersized pool (e.g. from imported XML)
    // by shrinking it back to 600×250 after elements were added
    const pool = reg.get(poolId);
    modeling.resizeShape(pool, {
      x: pool.x,
      y: pool.y,
      width: 600,
      height: 250,
    });

    // Autosize should expand the pool back to fit all elements
    const result = parseResult(await handleAutosizePoolsAndLanes({ diagramId }));

    expect(result.success).toBe(true);
    const processPool = result.poolResults.find((p: any) => p.participantName === 'Process');
    expect(processPool).toBeDefined();
    expect(processPool.resized).toBe(true);
    expect(processPool.newWidth).toBeGreaterThan(600);

    // Pool should now contain all elements
    const poolAfter = reg.get(poolId);
    for (const eid of elementIds) {
      const el = reg.get(eid);
      expect(el.x + el.width).toBeLessThanOrEqual(poolAfter.x + poolAfter.width + 5);
    }
  });
});

describe('lane height accommodates all assigned elements', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('lanes auto-expand pool when created', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', height: 250 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    // Create 5 lanes — should auto-expand pool from 250px
    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: poolId,
        lanes: [
          { name: 'Requester' },
          { name: 'Reviewer' },
          { name: 'Approver' },
          { name: 'Finance' },
          { name: 'Admin' },
        ],
      })
    );

    expect(lanesResult.success).toBe(true);
    expect(lanesResult.laneCount).toBe(5);

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const pool = reg.get(poolId);

    // 5 lanes × 150px = 750px minimum height
    expect(pool.height).toBeGreaterThanOrEqual(750);
  });
});

describe('layout detects pool truncation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('detectContainerSizingIssues finds undersized pool before layout', async () => {
    // Import the detection function directly
    const { detectContainerSizingIssues } =
      await import('../../../src/handlers/layout/layout-quality-metrics');

    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Process', width: 600, height: 250 },
          { name: 'External', collapsed: true },
        ],
      })
    );
    const poolId = collab.participantIds[0];

    // Add elements that extend across a wide area
    // bpmn-js auto-expands the pool during element addition
    for (let i = 0; i < 8; i++) {
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: `Task ${i + 1}`,
        participantId: poolId,
        x: 200 + i * 150,
        y: 200,
      });
    }

    // Simulate a manually undersized pool (e.g. from imported XML with bad bounds)
    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const modeling = diagram.modeler.get('modeling') as any;
    const pool = reg.get(poolId);
    modeling.resizeShape(pool, {
      x: pool.x,
      y: pool.y,
      width: 600,
      height: 250,
    });

    // Detection should find the undersized pool (elements overflow the shrunk pool)
    const issues = detectContainerSizingIssues(reg);
    expect(issues.length).toBeGreaterThan(0);
    const poolIssue = issues.find((i: any) => i.containerId === poolId);
    expect(poolIssue).toBeDefined();
    expect(poolIssue!.recommendedWidth).toBeGreaterThan(600);

    // After layout, the pool is expanded to fit, so issues should be resolved
    const layoutResult = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(layoutResult.success).toBe(true);
    const postLayoutIssues = detectContainerSizingIssues(reg);
    const postLayoutPoolIssue = postLayoutIssues.find((i: any) => i.containerId === poolId);
    expect(postLayoutPoolIssue).toBeUndefined();
  });
});

describe('subprocess minimum bounds', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('subprocess has minimum bounds for nested elements', async () => {
    const diagramId = await createDiagram();

    // Create a subprocess with nested elements
    const start = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:StartEvent', name: 'Start' })
    );

    const subprocess = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:SubProcess', name: 'Sub Process' })
    );

    const end = parseResult(
      await handleAddElement({ diagramId, elementType: 'bpmn:EndEvent', name: 'End' })
    );

    await connect(diagramId, start.elementId, subprocess.elementId);
    await connect(diagramId, subprocess.elementId, end.elementId);

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry');
    const subElement = reg.get(subprocess.elementId);

    // Subprocess should have minimum dimensions (350x200 as per ELEMENT_SIZES.subprocess)
    expect(subElement.width).toBeGreaterThanOrEqual(350);
    expect(subElement.height).toBeGreaterThanOrEqual(200);
  });
});
