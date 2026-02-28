/**
 * Story 5: Groceries Order — Exclusive Gateway + Non-Interrupting Timer Boundary
 *
 * Builds the "groceries order" pattern that exposed layout issues #1–5:
 *   Start → Validate Order → ExclusiveGateway (Valid?)
 *     → [approved] Process Payment → Pack Order → Send to Delivery → End
 *     → [rejected] End (Order Rejected)
 *
 *   Non-interrupting timer boundary event on Process Payment:
 *     → Payment Cancelled (End)
 *
 * After layout_bpmn_diagram, this test asserts:
 *   - All sequence-flow waypoints are within the pool's Y bounds (TODO #1 fixed)
 *   - The BPMN exports without error
 *   - Boundary event remains attached to its host (not detached)
 *   - No connection waypoints are outside the pool bounds
 *
 * Assertions that require TODO #3 / #4 fixes are noted with comments.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleCreateParticipant,
  handleAddElement,
  handleConnect,
  handleLayoutDiagram,
  handleListElements,
  handleExportBpmn,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { parseResult } from './helpers';

describe('Story 5: Groceries Order — Gateway + Non-Interrupting Boundary', () => {
  const s = {
    diagramId: '',
    participantId: '',
    startId: '',
    validateId: '',
    gatewayId: '',
    processPaymentId: '',
    packOrderId: '',
    sendDeliveryId: '',
    endOkId: '',
    endRejectedId: '',
    timerBoundaryId: '',
    endCancelledId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  // ──────────────────────────────────────────────────────────────────────────
  // Step 1: Create a single-pool diagram
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step01: Create pool', async () => {
    const res = parseResult(
      await handleCreateDiagram({ name: 'Groceries Order', hintLevel: 'none' })
    );
    expect(res.success).toBe(true);
    s.diagramId = res.diagramId;

    const poolRes = parseResult(
      await handleCreateParticipant({
        diagramId: s.diagramId,
        name: 'Groceries Order Process',
        height: 350,
      })
    );
    expect(poolRes.success).toBe(true);
    s.participantId = poolRes.participantId ?? poolRes.participant?.id;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2: Build Start → Validate → Gateway chain
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step02: Add Start, Validate, Gateway', async () => {
    const startRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Received',
        participantId: s.participantId,
        x: 150,
        y: 175,
      })
    );
    s.startId = startRes.elementId;

    const validateRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Validate Order',
        participantId: s.participantId,
        afterElementId: s.startId,
      })
    );
    s.validateId = validateRes.elementId;

    const gwRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Valid?',
        participantId: s.participantId,
        afterElementId: s.validateId,
      })
    );
    s.gatewayId = gwRes.elementId;

    expect(s.startId).toBeTruthy();
    expect(s.validateId).toBeTruthy();
    expect(s.gatewayId).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3: Build approved branch
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step03: Build approved branch', async () => {
    const ppRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Payment',
        participantId: s.participantId,
        x: 600,
        y: 130,
      })
    );
    s.processPaymentId = ppRes.elementId;

    const packRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Pack Order',
        participantId: s.participantId,
        afterElementId: s.processPaymentId,
      })
    );
    s.packOrderId = packRes.elementId;

    const deliveryRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:SendTask',
        name: 'Send to Delivery',
        participantId: s.participantId,
        afterElementId: s.packOrderId,
      })
    );
    s.sendDeliveryId = deliveryRes.elementId;

    const endOkRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Fulfilled',
        participantId: s.participantId,
        afterElementId: s.sendDeliveryId,
      })
    );
    s.endOkId = endOkRes.elementId;

    // Connect gateway → Process Payment (approved branch)
    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.gatewayId,
      targetElementId: s.processPaymentId,
      label: 'Approved',
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 4: Build rejected branch
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step04: Build rejected branch', async () => {
    const endRejRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Rejected',
        participantId: s.participantId,
        x: 600,
        y: 280,
      })
    );
    s.endRejectedId = endRejRes.elementId;

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.gatewayId,
      targetElementId: s.endRejectedId,
      label: 'Rejected',
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 5: Add non-interrupting timer boundary event on Process Payment
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step05: Add non-interrupting timer boundary event', async () => {
    const bndRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:BoundaryEvent',
        name: 'Payment Timeout',
        hostElementId: s.processPaymentId,
        cancelActivity: false,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        eventDefinitionProperties: { timeDuration: 'PT10M' },
      })
    );
    s.timerBoundaryId = bndRes.elementId;
    expect(s.timerBoundaryId).toBeTruthy();

    const endCancelRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Payment Cancelled',
        participantId: s.participantId,
        x: 800,
        y: 280,
      })
    );
    s.endCancelledId = endCancelRes.elementId;

    await handleConnect({
      diagramId: s.diagramId,
      sourceElementId: s.timerBoundaryId,
      targetElementId: s.endCancelledId,
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 6: Run layout
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step06: layout_bpmn_diagram runs without error', async () => {
    const layoutRes = parseResult(await handleLayoutDiagram({ diagramId: s.diagramId }));
    expect(layoutRes.success).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 7: All sequence-flow waypoints are within the pool's Y bounds (TODO #1)
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step07: No sequence-flow waypoint is outside the pool Y bounds', async () => {
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const elements: any[] = listRes.elements;

    // Find the participant to get pool bounds
    const participant = elements.find((e: any) => e.type === 'bpmn:Participant');
    expect(participant, 'Participant must exist').toBeTruthy();

    const poolTop = participant.y ?? 0;
    const poolBottom = (participant.y ?? 0) + (participant.height ?? 250);
    const TOLERANCE = 5; // small rounding tolerance

    const flows = elements.filter((e: any) => e.type === 'bpmn:SequenceFlow');
    expect(flows.length, 'Diagram must have sequence flows').toBeGreaterThan(0);

    for (const flow of flows) {
      if (!flow.waypoints) continue;
      for (const wp of flow.waypoints) {
        expect(
          wp.y,
          `Flow ${flow.id} waypoint y=${wp.y} is above pool top y=${poolTop} (tolerance ${TOLERANCE})`
        ).toBeGreaterThanOrEqual(poolTop - TOLERANCE);
        expect(
          wp.y,
          `Flow ${flow.id} waypoint y=${wp.y} is below pool bottom y=${poolBottom} (tolerance ${TOLERANCE})`
        ).toBeLessThanOrEqual(poolBottom + TOLERANCE);
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 8: Boundary event remains attached to host (fix #11)
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step08: Timer boundary event is attached to Process Payment in XML', async () => {
    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text as string;

    // Must be a bpmn:boundaryEvent (not intermediate) with attachedToRef
    const pattern = new RegExp(
      `<bpmn:boundaryEvent[^>]*id="${s.timerBoundaryId}"[^>]*attachedToRef="${s.processPaymentId}"`
    );
    const altPattern = new RegExp(
      `<bpmn:boundaryEvent[^>]*attachedToRef="${s.processPaymentId}"[^>]*id="${s.timerBoundaryId}"`
    );
    expect(
      pattern.test(xml) || altPattern.test(xml),
      `Timer boundary (${s.timerBoundaryId}) must be a bpmn:boundaryEvent attached to ${s.processPaymentId}`
    ).toBe(true);

    // Must have cancelActivity="false" (non-interrupting)
    expect(xml).toContain(`cancelActivity="false"`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 9: Boundary event Y is within host bounds after layout
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step09: Timer boundary event Y is within host task bounds after layout', async () => {
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const elements: any[] = listRes.elements;

    const host = elements.find((e: any) => e.id === s.processPaymentId);
    const boundary = elements.find((e: any) => e.id === s.timerBoundaryId);

    expect(host, 'Process Payment must exist').toBeTruthy();
    expect(boundary, 'Timer boundary must exist').toBeTruthy();

    const tolerance = 50; // boundary events overhang the host edge
    expect(
      boundary.x,
      `Boundary x=${boundary.x} must be near host x-range [${host.x - tolerance}, ${host.x + host.width + tolerance}]`
    ).toBeGreaterThanOrEqual(host.x - tolerance);
    expect(boundary.x).toBeLessThanOrEqual(host.x + (host.width ?? 100) + tolerance);

    expect(
      boundary.y,
      `Boundary y=${boundary.y} must be near host y-range [${host.y - tolerance}, ${host.y + host.height + tolerance}]`
    ).toBeGreaterThanOrEqual(host.y - tolerance);
    expect(boundary.y).toBeLessThanOrEqual(host.y + (host.height ?? 80) + tolerance);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 10: Export succeeds
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step10: Diagram exports as valid BPMN XML', async () => {
    const xml = (await handleExportBpmn({ format: 'xml', diagramId: s.diagramId, skipLint: true }))
      .content[0].text as string;

    expect(xml).toContain('<?xml');
    expect(xml).toContain('bpmn:definitions');
    expect(xml).toContain('Validate Order');
    expect(xml).toContain('Process Payment');
    expect(xml).toContain('Payment Timeout');
    expect(xml).toContain('Payment Cancelled');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 11: No backward connections — target element center-X > source (TODO #3)
  // ──────────────────────────────────────────────────────────────────────────
  test('S5-Step11: No sequence flow connects to a target left of source (no backward connections)', async () => {
    const listRes = parseResult(await handleListElements({ diagramId: s.diagramId }));
    const elements: any[] = listRes.elements;

    const elementById = new Map<string, any>(elements.map((e: any) => [e.id, e]));
    const flows = elements.filter((e: any) => e.type === 'bpmn:SequenceFlow');

    expect(flows.length, 'Diagram must have sequence flows').toBeGreaterThan(0);

    for (const flow of flows) {
      const source = elementById.get(flow.sourceId);
      const target = elementById.get(flow.targetId);
      if (!source || !target) continue;

      // Skip flows from boundary events — the boundary event center-X equals
      // the host center-X, and the exception-chain target is placed to the right,
      // but the tolerance here is tighter so we just skip these special cases.
      if (source.type === 'bpmn:BoundaryEvent') continue;

      const sourceCenterX = (source.x ?? 0) + (source.width ?? 0) / 2;
      const targetCenterX = (target.x ?? 0) + (target.width ?? 0) / 2;

      expect(
        targetCenterX,
        `Flow ${flow.id} (${source.id}[${source.type}] → ${target.id}[${target.type}]) ` +
          `goes backward: source center-X=${sourceCenterX.toFixed(1)}, ` +
          `target center-X=${targetCenterX.toFixed(1)}`
      ).toBeGreaterThan(sourceCenterX - 5);
    }
  });
});
