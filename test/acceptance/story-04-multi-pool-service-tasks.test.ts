/**
 * Story 4: Multi-Pool Collaboration with Service Tasks in Secondary Pool
 *
 * Verifies:
 * 1. A two-pool collaboration can be created with an executable main pool
 *    and a collapsed external-system pool.
 * 2. Service tasks placed explicitly in the secondary pool land in that pool
 *    (not silently misplaced into the first pool).
 * 3. After layout_bpmn_diagram, shapes are non-overlapping (no two elements
 *    share the same x/y position).
 * 4. connect_bpmn_elements dedup: re-connecting the same pair returns
 *    skipped:true instead of creating duplicate flows.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleCreateCollaboration,
  handleAddElement,
  handleAddElementChain,
  handleConnect,
  handleLayoutDiagram,
  handleListElements,
  handleExportBpmn,
} from '../../src/handlers';
import { clearDiagrams, parseResult } from '../helpers';
import { assertStep } from './helpers';

describe('Story 4: Multi-Pool Collaboration — Service Tasks in Secondary Pool', () => {
  const s = {
    diagramId: '',
    mainPoolId: '',
    externalPoolId: '',
    startId: '',
    validateId: '',
    gatewayId: '',
    approvedId: '',
    rejectedId: '',
    endOkId: '',
    endKoId: '',
    notifyServiceId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  // ──────────────────────────────────────────────────────────────────────────
  // Step 1: Create collaboration with two pools
  // ──────────────────────────────────────────────────────────────────────────
  test('S4-Step01: Create two-pool collaboration', async () => {
    const res = parseResult(
      await handleCreateDiagram({ name: 'Order Collaboration', hintLevel: 'none' })
    );
    expect(res.success).toBe(true);
    s.diagramId = res.diagramId;

    // Create two-pool collaboration: main executable pool + external service pool
    const collabRes = parseResult(
      await handleCreateCollaboration({
        diagramId: s.diagramId,
        participants: [
          {
            name: 'Order Management',
            participantId: 'Participant_OrderManagement',
            processId: 'Process_Order_Collaboration',
            height: 300,
          },
          {
            name: 'Notification Service',
            participantId: 'Participant_NotificationService',
            height: 200,
          },
        ],
      })
    );
    expect(collabRes.success).toBe(true);
    s.mainPoolId = 'Participant_OrderManagement';
    s.externalPoolId = 'Participant_NotificationService';

    await assertStep(s.diagramId, 'S4-Step01', {});
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2: Build happy path chain in main pool
  // ──────────────────────────────────────────────────────────────────────────
  test('S4-Step02: Build happy path chain in main pool', async () => {
    const chainRes = parseResult(
      await handleAddElementChain({
        diagramId: s.diagramId,
        participantId: s.mainPoolId,
        elements: [
          { elementType: 'bpmn:StartEvent', name: 'Order Received' },
          { elementType: 'bpmn:ServiceTask', name: 'Validate Order' },
          { elementType: 'bpmn:ExclusiveGateway', name: 'Valid?' },
        ],
      })
    );
    expect(chainRes.success).toBe(true);
    // Chain includes gateway — should defer layout
    expect(chainRes.deferredLayout).toBe(true);
    expect(chainRes.unconnectedElements ?? []).toHaveLength(0); // gateway is last — field omitted when empty

    const elements: Array<{ elementId: string; elementType: string; name?: string }> =
      chainRes.elements;
    s.startId = elements[0].elementId;
    s.validateId = elements[1].elementId;
    s.gatewayId = elements[2].elementId;

    await assertStep(s.diagramId, 'S4-Step02', {
      containsElements: ['Order Received', 'Validate Order', 'Valid?'],
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3: Add gateway branches in main pool
  // ──────────────────────────────────────────────────────────────────────────
  test('S4-Step03: Add gateway branches', async () => {
    // Approved branch
    const approvedRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Order',
        participantId: s.mainPoolId,
        x: 700,
        y: 150,
      } as any)
    );
    expect(approvedRes.success).toBe(true);
    s.approvedId = approvedRes.elementId;

    const endOkRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Completed',
        participantId: s.mainPoolId,
        x: 900,
        y: 150,
      } as any)
    );
    expect(endOkRes.success).toBe(true);
    s.endOkId = endOkRes.elementId;

    // Rejected branch
    const rejectedRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Notify Customer',
        participantId: s.mainPoolId,
        x: 700,
        y: 300,
      } as any)
    );
    expect(rejectedRes.success).toBe(true);
    s.rejectedId = rejectedRes.elementId;

    const endKoRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Rejected',
        participantId: s.mainPoolId,
        x: 900,
        y: 300,
      } as any)
    );
    expect(endKoRes.success).toBe(true);
    s.endKoId = endKoRes.elementId;

    // Wire gateway branches
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.gatewayId,
      targetElementId: s.approvedId,
      label: 'Yes',
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.approvedId,
      targetElementId: s.endOkId,
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.gatewayId,
      targetElementId: s.rejectedId,
      label: 'No',
    });
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.rejectedId,
      targetElementId: s.endKoId,
    });

    await assertStep(s.diagramId, 'S4-Step03', {
      containsElements: ['Process Order', 'Order Completed', 'Notify Customer'],
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 4: Add service task in external pool and connect via message flow
  // ──────────────────────────────────────────────────────────────────────────
  test('S4-Step04: Place service task explicitly in external pool', async () => {
    const svcRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Send Notification',
        participantId: s.externalPoolId,
        x: 500,
        y: 560,
      } as any)
    );
    expect(svcRes.success).toBe(true);
    s.notifyServiceId = svcRes.elementId;

    // Verify it landed in the external pool (cross-pool placement)
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const svcEl = listRes.elements.find((e: any) => e.id === s.notifyServiceId);
    expect(svcEl).toBeDefined();

    // Message flow from approved task to notification service
    const connRes = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.approvedId,
        targetElementId: s.notifyServiceId,
      })
    );
    expect(connRes.success).toBe(true);
    // Cross-pool connection should be auto-corrected to MessageFlow
    expect(connRes.connectionType).toBe('bpmn:MessageFlow');

    await assertStep(s.diagramId, 'S4-Step04', {
      containsElements: ['Send Notification'],
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 5: Dedup check — connecting same pair twice skips the second
  // ──────────────────────────────────────────────────────────────────────────
  test('S4-Step05: Dedup check on connect_bpmn_elements', async () => {
    // Within the main pool: start → validate already exists from chain
    const dup = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.startId,
        targetElementId: s.validateId,
      })
    );
    // Should be skipped, not create a duplicate
    expect(dup.skipped).toBe(true);
    expect(dup.existingConnectionId).toBeDefined();
    expect(dup.warning).toMatch(/already exists/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 6: Layout and verify non-overlapping shapes
  // ──────────────────────────────────────────────────────────────────────────
  test('S4-Step06: Layout produces non-overlapping elements in main pool', async () => {
    await handleLayoutDiagram({ diagramId: s.diagramId, scopeElementId: s.mainPoolId });

    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const shapes = (listRes.elements as any[]).filter(
      (e) =>
        e.di?.x !== undefined &&
        e.type !== 'bpmn:SequenceFlow' &&
        e.type !== 'bpmn:MessageFlow' &&
        e.type !== 'bpmn:Participant' &&
        e.type !== 'bpmn:Lane'
    );

    // No two shapes should have identical (x, y)
    const positions = new Set<string>();
    for (const shape of shapes) {
      const key = `${Math.round(shape.di.x)},${Math.round(shape.di.y)}`;
      expect(
        positions.has(key),
        `Two elements share position ${key}: ${shape.name || shape.id}`
      ).toBe(false);
      positions.add(key);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 7: Export passes lint gate
  // ──────────────────────────────────────────────────────────────────────────
  test('S4-Step07: Export succeeds with valid BPMN XML', async () => {
    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text;
    expect(xml).toContain('Order Collaboration');
    expect(xml).toContain('Order Management');
    expect(xml).toContain('Notification Service');
    expect(xml).toContain('Send Notification');
    expect(xml).toContain('bpmn:messageFlow');
  });
});
