/**
 * Tests for collaboration layout via handleLayoutDiagram.
 *
 * Verifies that layout_bpmn_diagram works with multi-participant
 * collaboration diagrams.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  handleLayoutDiagram,
  handleCreateCollaboration,
  handleAddElement,
} from '../../../src/handlers';
import { parseResult, createDiagram, clearDiagrams, connect } from '../../helpers';

describe('collaboration layout', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('lays out a collaboration with two participants', async () => {
    const diagramId = await createDiagram();

    const collab = parseResult(
      await handleCreateCollaboration({
        diagramId,
        participants: [{ name: 'Customer' }, { name: 'Supplier' }],
      })
    );

    const customerPool = collab.participantIds[0];
    const _supplierPool = collab.participantIds[1];

    // Add elements to each pool
    const startRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Order Placed',
        participantId: customerPool,
      })
    );
    const taskRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Process Order',
        participantId: customerPool,
      })
    );
    const endRes = parseResult(
      await handleAddElement({
        diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Order Done',
        participantId: customerPool,
      })
    );

    await connect(diagramId, startRes.elementId, taskRes.elementId);
    await connect(diagramId, taskRes.elementId, endRes.elementId);

    // Run layout
    const res = parseResult(await handleLayoutDiagram({ diagramId }));
    expect(res.success).toBe(true);
    expect(res.elementCount).toBeGreaterThanOrEqual(2);
  });
});
