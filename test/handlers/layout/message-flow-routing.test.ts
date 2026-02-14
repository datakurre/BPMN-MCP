/**
 * Tests for message flow routing in collaboration diagrams.
 *
 * Verifies that message flows between pools are routed with clean
 * vertical-horizontal-vertical dog-leg paths instead of diagonal lines.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateCollaboration,
  handleAddElement,
  handleConnect,
} from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('message flow routing', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('message flows between pools use orthogonal dog-leg routes', async () => {
    const diagramId = await createDiagram('Message Flow Test');

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Service' }],
      })
    );

    const poolA = collab.participantIds[0];
    const poolB = collab.participantIds[1];

    // Add elements in different pools
    const sendTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:SendTask',
        name: 'Send Request',
        participantId: poolA,
      })
    );
    const receiveTask = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ReceiveTask',
        name: 'Receive Request',
        participantId: poolB,
      })
    );

    // Create message flow
    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: sendTask.elementId,
        targetElementId: receiveTask.elementId,
      })
    );

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const msgFlow = reg.get(conn.connectionId);

    expect(msgFlow).toBeDefined();
    expect(msgFlow.waypoints).toBeDefined();
    expect(msgFlow.waypoints.length).toBeGreaterThanOrEqual(2);

    // All segments should be orthogonal (no diagonal lines)
    const wps = msgFlow.waypoints;
    for (let i = 1; i < wps.length; i++) {
      const dx = Math.abs(wps[i].x - wps[i - 1].x);
      const dy = Math.abs(wps[i].y - wps[i - 1].y);
      const isHorizontal = dy < 2;
      const isVertical = dx < 2;
      expect(
        isHorizontal || isVertical,
        `Message flow segment ${i - 1}→${i} is diagonal: ` +
          `(${wps[i - 1].x},${wps[i - 1].y}) → (${wps[i].x},${wps[i].y})`
      ).toBe(true);
    }
  });

  test('message flow with aligned elements produces minimal waypoints', async () => {
    const diagramId = await createDiagram('Aligned Message Flow');

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Sender' }, { name: 'Receiver' }],
      })
    );

    const poolA = collab.participantIds[0];
    const poolB = collab.participantIds[1];

    const taskA = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Send',
        participantId: poolA,
      })
    );
    const taskB = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Receive',
        participantId: poolB,
      })
    );

    const conn = parseResult(
      await handleConnect({
        diagramId,
        sourceElementId: taskA.elementId,
        targetElementId: taskB.elementId,
      })
    );

    await handleLayoutDiagram({ diagramId });

    const reg = getDiagram(diagramId)!.modeler.get('elementRegistry');
    const msgFlow = reg.get(conn.connectionId);

    expect(msgFlow).toBeDefined();
    expect(msgFlow.waypoints).toBeDefined();

    // Message flow should have at most 4 waypoints for a dog-leg route
    // (or 2 for a straight vertical line if elements are aligned)
    expect(msgFlow.waypoints.length).toBeLessThanOrEqual(4);
  });
});
