/**
 * Scenario builder functions for layout testing.
 *
 * Each builder creates a BPMN diagram programmatically (no fixture files)
 * and returns named layout expectations to assert after `layout_bpmn_diagram`.
 *
 * Covers scenarios S01–S14 from the layout testing plan in TODO.md.
 * Scenarios S06, S07, S13, S14 target bugs observed in the demo session.
 */

import { handleCreateLanes, handleCreateCollaboration, handleAddElement } from '../../src/handlers';
import { createDiagram, addElement, connect, parseResult } from '../utils/diagram';
import { expect } from 'vitest';
import {
  assertOrthogonalFlows,
  assertNoOverlaps,
  assertDistinctRows,
  assertSameRow,
  assertLeftToRight,
  assertInLane,
  assertContainedIn,
  assertAllElementsHaveShape,
  assertAllFlowsForward,
} from './layout-invariants';
import type { ElementRegistry } from '../../src/bpmn-types';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LayoutExpectation {
  /** Human-readable label shown in failure messages. */
  label: string;
  /** The assertion; throws on failure. */
  assert: (registry: ElementRegistry) => void;
}

export interface LayoutScenario {
  /** Short name used as the test description. */
  name: string;
  /** Builds the diagram; returns IDs and expected layout assertions. */
  build: () => Promise<{
    diagramId: string;
    expectations: LayoutExpectation[];
  }>;
}

// ── S01: Linear flow ───────────────────────────────────────────────────────

const s01LinearFlow: LayoutScenario = {
  name: 'S01: Linear flow (5 elements)',
  build: async () => {
    const diagramId = await createDiagram('S01 Linear');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const t1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Collect Info' });
    const t2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Validate' });
    const t3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Approve' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });
    await connect(diagramId, start, t1);
    await connect(diagramId, t1, t2);
    await connect(diagramId, t2, t3);
    await connect(diagramId, t3, end);

    const ids = [start, t1, t2, t3, end];
    return {
      diagramId,
      expectations: [
        { label: 'all elements on same Y row', assert: (reg) => assertSameRow(reg, ids, 5) },
        { label: 'elements left-to-right', assert: (reg) => assertLeftToRight(reg, ids) },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'no element overlaps', assert: (reg) => assertNoOverlaps(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S02: Exclusive gateway diamond ────────────────────────────────────────

const s02ExclusiveDiamond: LayoutScenario = {
  name: 'S02: Exclusive gateway diamond',
  build: async () => {
    const diagramId = await createDiagram('S02 Exclusive Diamond');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Decision' });
    const taskYes = await addElement(diagramId, 'bpmn:UserTask', { name: 'Yes Path' });
    const taskNo = await addElement(diagramId, 'bpmn:UserTask', { name: 'No Path' });
    const merge = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Merge' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskYes, { label: 'Yes' });
    await connect(diagramId, gw, taskNo, { label: 'No', isDefault: true });
    await connect(diagramId, taskYes, merge);
    await connect(diagramId, taskNo, merge);
    await connect(diagramId, merge, end);

    return {
      diagramId,
      expectations: [
        {
          label: 'branch tasks on distinct Y rows',
          assert: (reg) => assertDistinctRows(reg, [taskYes, taskNo], 10),
        },
        {
          label: 'split, merge, end ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [gw, merge, end]),
        },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'no element overlaps', assert: (reg) => assertNoOverlaps(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S03: Parallel fork-join ────────────────────────────────────────────────

const s03ParallelForkJoin: LayoutScenario = {
  name: 'S03: Parallel fork-join (3 branches)',
  build: async () => {
    const diagramId = await createDiagram('S03 Parallel Fork-Join');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const b1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 1' });
    const b2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Branch 2' });
    const b3 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Branch 3' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, b1);
    await connect(diagramId, split, b2);
    await connect(diagramId, split, b3);
    await connect(diagramId, b1, join);
    await connect(diagramId, b2, join);
    await connect(diagramId, b3, join);
    await connect(diagramId, join, end);

    return {
      diagramId,
      expectations: [
        {
          label: 'all three branch tasks on distinct Y rows',
          assert: (reg) => assertDistinctRows(reg, [b1, b2, b3], 10),
        },
        {
          label: 'split and join ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [split, join]),
        },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'no element overlaps', assert: (reg) => assertNoOverlaps(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S04: Nested subprocess ────────────────────────────────────────────────

const s04NestedSubprocess: LayoutScenario = {
  name: 'S04: Nested expanded subprocess',
  build: async () => {
    const diagramId = await createDiagram('S04 Subprocess');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const sub = await addElement(diagramId, 'bpmn:SubProcess', {
      name: 'Sub Process',
      isExpanded: true,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End' });

    const subStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Sub Start',
        parentId: sub,
      })
    ).elementId;
    const subTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Sub Task',
        parentId: sub,
      })
    ).elementId;
    const subEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Sub End',
        parentId: sub,
      })
    ).elementId;
    await connect(diagramId, subStart, subTask);
    await connect(diagramId, subTask, subEnd);
    await connect(diagramId, start, sub);
    await connect(diagramId, sub, end);

    return {
      diagramId,
      expectations: [
        {
          label: 'outer elements ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [start, sub, end]),
        },
        {
          label: 'subprocess children ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [subStart, subTask, subEnd]),
        },
        {
          label: 'subprocess children contained within subprocess bounds',
          assert: (reg) => assertContainedIn(reg, [subStart, subTask, subEnd], sub),
        },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S06: Pool with 2 lanes, cross-lane flow ───────────────────────────────

const s06TwoLanePool: LayoutScenario = {
  name: 'S06: Pool with 2 lanes, cross-lane flow',
  build: async () => {
    const diagramId = await createDiagram('S06 Two Lanes');
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Two Lane Process',
      x: 400,
      y: 300,
    });

    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    const [laneA, laneB] = lanesResult.laneIds as string[];

    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
        participantId: participant,
        laneId: laneA,
      })
    ).elementId;
    const taskA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Task A',
        participantId: participant,
        laneId: laneA,
      })
    ).elementId;
    const taskB = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Task B',
        participantId: participant,
        laneId: laneB,
      })
    ).elementId;
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'End',
        participantId: participant,
        laneId: laneB,
      })
    ).elementId;

    await connect(diagramId, start, taskA);
    await connect(diagramId, taskA, taskB);
    await connect(diagramId, taskB, end);

    return {
      diagramId,
      expectations: [
        {
          label: 'start and taskA are in Lane A',
          assert: (reg) => {
            assertInLane(reg, start, laneA);
            assertInLane(reg, taskA, laneA);
          },
        },
        {
          label: 'taskB and end are in Lane B',
          assert: (reg) => {
            assertInLane(reg, taskB, laneB);
            assertInLane(reg, end, laneB);
          },
        },
        {
          label: 'lane A and lane B elements are on distinct Y rows',
          assert: (reg) => assertDistinctRows(reg, [taskA, taskB], 20),
        },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S07: Pool with 3 lanes, parallel split to different lanes ─────────────

const s07ThreeLaneParallel: LayoutScenario = {
  name: 'S07: Pool with 3 lanes, parallel split to different lanes',
  build: async () => {
    const diagramId = await createDiagram('S07 Three Lane Parallel');
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Three Lane Process',
      x: 400,
      y: 300,
    });

    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Requester' }, { name: 'Reviewer' }, { name: 'Publisher' }],
      })
    );
    const [laneRequester, laneReviewer, lanePublisher] = lanesResult.laneIds as string[];

    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;
    const submit = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Submit Request',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;
    const split = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ParallelGateway',
        name: 'Split',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;
    const review = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Request',
        participantId: participant,
        laneId: laneReviewer,
      })
    ).elementId;
    const publish = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Publish Content',
        participantId: participant,
        laneId: lanePublisher,
      })
    ).elementId;
    const join = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ParallelGateway',
        name: 'Join',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;

    await connect(diagramId, start, submit);
    await connect(diagramId, submit, split);
    await connect(diagramId, split, review);
    await connect(diagramId, split, publish);
    await connect(diagramId, review, join);
    await connect(diagramId, publish, join);
    await connect(diagramId, join, end);

    return {
      diagramId,
      expectations: [
        {
          label: 'review task is in Reviewer lane',
          assert: (reg) => assertInLane(reg, review, laneReviewer),
        },
        {
          label: 'publish task is in Publisher lane',
          assert: (reg) => assertInLane(reg, publish, lanePublisher),
        },
        {
          label: 'review and publish are on distinct Y rows (no overlap)',
          assert: (reg) => assertDistinctRows(reg, [review, publish], 20),
        },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S08: Collaboration (2 pools, message flow) ────────────────────────────

const s08Collaboration: LayoutScenario = {
  name: 'S08: Collaboration with 2 pools and message flow',
  build: async () => {
    const diagramId = await createDiagram('S08 Collaboration');

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [
          { name: 'Customer', width: 600 },
          { name: 'Supplier', width: 600 },
        ],
      })
    );
    const [custPool, suppPool] = collab.participantIds as string[];

    const custStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Place Order',
        participantId: custPool,
      })
    ).elementId;
    const custTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Submit',
        participantId: custPool,
      })
    ).elementId;
    const custEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        participantId: custPool,
      })
    ).elementId;
    await connect(diagramId, custStart, custTask);
    await connect(diagramId, custTask, custEnd);

    const suppStart = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Receive Order',
        participantId: suppPool,
      })
    ).elementId;
    const suppTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Fulfill',
        participantId: suppPool,
      })
    ).elementId;
    const suppEnd = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Shipped',
        participantId: suppPool,
      })
    ).elementId;
    await connect(diagramId, suppStart, suppTask);
    await connect(diagramId, suppTask, suppEnd);
    await connect(diagramId, custTask, suppStart);

    return {
      diagramId,
      expectations: [
        {
          label: 'pools are stacked vertically (distinct Y ranges)',
          assert: (reg) => {
            const cust = (reg as any).get(custPool);
            const supp = (reg as any).get(suppPool);
            // Non-overlapping in Y
            const custBottom = cust.y + cust.height;
            const suppBottom = supp.y + supp.height;
            const noOverlap = custBottom <= supp.y + 1 || suppBottom <= cust.y + 1;
            expect(noOverlap, 'Pools should be stacked without Y overlap').toBe(true);
          },
        },
        {
          label: 'customer pool elements are ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [custStart, custTask, custEnd]),
        },
        {
          label: 'supplier pool elements are ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [suppStart, suppTask, suppEnd]),
        },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S13: Open-fan parallel (no merge) ────────────────────────────────────

const s13OpenFanParallel: LayoutScenario = {
  name: 'S13: Open-fan parallel split (no merge gateway)',
  build: async () => {
    const diagramId = await createDiagram('S13 Open Fan');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const split = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Split' });
    const review = await addElement(diagramId, 'bpmn:UserTask', { name: 'Review Request' });
    const publish = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Publish Content' });
    const join = await addElement(diagramId, 'bpmn:ParallelGateway', { name: 'Join' });
    const endA = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Reviewed Done' });
    const endB = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Published Done' });

    await connect(diagramId, start, split);
    await connect(diagramId, split, review);
    await connect(diagramId, split, publish);
    await connect(diagramId, review, join);
    await connect(diagramId, join, endA);
    await connect(diagramId, publish, endB); // branch B never reaches join

    return {
      diagramId,
      expectations: [
        {
          label: 'branch tasks are on distinct Y rows (no overlap)',
          assert: (reg) => assertDistinctRows(reg, [review, publish], 10),
        },
        {
          label: 'both branch tasks are to the right of the split gateway',
          assert: (reg) => {
            const splitEl = (reg as any).get(split);
            const reviewEl = (reg as any).get(review);
            const publishEl = (reg as any).get(publish);
            const splitRight = splitEl.x + splitEl.width;
            expect(reviewEl.x).toBeGreaterThan(splitRight - 1);
            expect(publishEl.x).toBeGreaterThan(splitRight - 1);
          },
        },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S14: Multi-lane + parallel gateway (demo session scenario) ─────────────

const s14MultiLaneParallelDemo: LayoutScenario = {
  name: 'S14: Multi-lane + parallel gateway (demo reproduction)',
  build: async () => {
    const diagramId = await createDiagram('S14 Demo Scenario');
    const participant = await addElement(diagramId, 'bpmn:Participant', {
      name: 'Review Process',
      x: 400,
      y: 300,
    });

    const lanesResult = parseResult(
      await handleCreateLanes({
        diagramId,
        participantId: participant,
        lanes: [{ name: 'Requester' }, { name: 'Reviewer' }, { name: 'Publisher' }],
      })
    );
    const [laneRequester, laneReviewer, lanePublisher] = lanesResult.laneIds as string[];

    const start = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;
    const fillForm = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Fill Request Form',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;
    const split = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ParallelGateway',
        name: 'Dispatch',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;
    const reviewTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Request',
        participantId: participant,
        laneId: laneReviewer,
      })
    ).elementId;
    const publishTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Publish Content',
        participantId: participant,
        laneId: lanePublisher,
      })
    ).elementId;
    const join = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ParallelGateway',
        name: 'Join After Work',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;
    const end = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Process Complete',
        participantId: participant,
        laneId: laneRequester,
      })
    ).elementId;

    await connect(diagramId, start, fillForm);
    await connect(diagramId, fillForm, split);
    await connect(diagramId, split, reviewTask);
    await connect(diagramId, split, publishTask);
    await connect(diagramId, reviewTask, join);
    await connect(diagramId, publishTask, join);
    await connect(diagramId, join, end);

    return {
      diagramId,
      expectations: [
        {
          label: 'reviewTask remains in Reviewer lane',
          assert: (reg) => assertInLane(reg, reviewTask, laneReviewer),
        },
        {
          label: 'publishTask remains in Publisher lane',
          assert: (reg) => assertInLane(reg, publishTask, lanePublisher),
        },
        {
          label: 'reviewTask and publishTask are on distinct Y rows',
          assert: (reg) => assertDistinctRows(reg, [reviewTask, publishTask], 20),
        },
        {
          label: 'main flow elements ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [start, fillForm, split, join, end]),
        },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── S15: Open-fan exclusive gateway, 2 branches with 2–3 tasks (TODO #3) ──

const s15OpenFanExclusiveTwoBranches: LayoutScenario = {
  name: 'S15: Open-fan exclusive gateway — two multi-task branches, no backward connections (TODO #3)',
  build: async () => {
    const diagramId = await createDiagram('S15 Open Fan Exclusive');
    const start = await addElement(diagramId, 'bpmn:StartEvent', { name: 'Start' });
    const gw = await addElement(diagramId, 'bpmn:ExclusiveGateway', { name: 'Route?' });

    // Branch A — 3 tasks (longer branch)
    const taskA1 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process A1' });
    const taskA2 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Process A2' });
    const taskA3 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Process A3' });
    const endA = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done A' });

    // Branch B — 2 tasks (shorter branch)
    const taskB1 = await addElement(diagramId, 'bpmn:UserTask', { name: 'Handle B1' });
    const taskB2 = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Handle B2' });
    const endB = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Done B' });

    await connect(diagramId, start, gw);
    await connect(diagramId, gw, taskA1, { label: 'Path A' });
    await connect(diagramId, taskA1, taskA2);
    await connect(diagramId, taskA2, taskA3);
    await connect(diagramId, taskA3, endA);
    await connect(diagramId, gw, taskB1, { label: 'Path B' });
    await connect(diagramId, taskB1, taskB2);
    await connect(diagramId, taskB2, endB);

    return {
      diagramId,
      expectations: [
        {
          label: 'branch A and B first tasks are on distinct Y rows',
          assert: (reg) => assertDistinctRows(reg, [taskA1, taskB1], 10),
        },
        {
          label: 'branch A elements are ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [start, gw, taskA1, taskA2, taskA3, endA]),
        },
        {
          label: 'branch B elements are ordered left-to-right',
          assert: (reg) => assertLeftToRight(reg, [gw, taskB1, taskB2, endB]),
        },
        {
          label: 'all flows are left-to-right (no backward connections) — TODO #3',
          assert: (reg) => assertAllFlowsForward(reg),
        },
        { label: 'no element overlaps', assert: (reg) => assertNoOverlaps(reg) },
        { label: 'all flows orthogonal', assert: (reg) => assertOrthogonalFlows(reg) },
        { label: 'all elements have DI shape', assert: (reg) => assertAllElementsHaveShape(reg) },
      ],
    };
  },
};

// ── Scenario registry ──────────────────────────────────────────────────────

export const scenarios: LayoutScenario[] = [
  s01LinearFlow,
  s02ExclusiveDiamond,
  s03ParallelForkJoin,
  s04NestedSubprocess,
  s06TwoLanePool,
  s07ThreeLaneParallel,
  s08Collaboration,
  s13OpenFanParallel,
  s14MultiLaneParallelDemo,
  s15OpenFanExclusiveTwoBranches,
];
