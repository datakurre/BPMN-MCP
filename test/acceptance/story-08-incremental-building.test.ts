/**
 * Story 8: Incremental Building — bpmn-js-style placement without layout
 *
 * Verifies that building a diagram incrementally using MCP tools (like a real
 * AI agent would) produces clean placement without needing layout_bpmn_diagram.
 *
 * Covers: create_bpmn_diagram, add_bpmn_element (afterElementId),
 * connect_bpmn_elements, export_bpmn
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  handleCreateDiagram,
  handleAddElement,
  handleConnect,
  handleExportBpmn,
} from '../../src/handlers';
import { clearDiagrams } from '../helpers';
import { assertStep, parseResult } from './helpers';

describe('Story 8: Incremental Building — bpmn-js style placement', () => {
  const s = {
    diagramId: '',
    startId: '',
    taskId: '',
    gatewayId: '',
    branch1TaskId: '',
    branch2TaskId: '',
    endId: '',
  };

  beforeAll(() => clearDiagrams());
  afterAll(() => clearDiagrams());

  test('S8-Step01: Create diagram and add start event', async () => {
    const res = parseResult(await handleCreateDiagram({ name: 'Incremental Build' }));
    expect(res.success).toBe(true);
    s.diagramId = res.diagramId;

    const startRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:StartEvent',
        name: 'Start',
      })
    );
    expect(startRes.success).toBe(true);
    s.startId = startRes.elementId;
  });

  test('S8-Step02: Add task after start event', async () => {
    const taskRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:UserTask',
        name: 'Review Request',
        afterElementId: s.startId,
      })
    );
    expect(taskRes.success).toBe(true);
    s.taskId = taskRes.elementId;
  });

  test('S8-Step03: Add exclusive gateway after task', async () => {
    const gwRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ExclusiveGateway',
        name: 'Approved?',
        afterElementId: s.taskId,
      })
    );
    expect(gwRes.success).toBe(true);
    s.gatewayId = gwRes.elementId;
  });

  test('S8-Step04: Add first branch task after gateway', async () => {
    const b1Res = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Process Approval',
        afterElementId: s.gatewayId,
      })
    );
    expect(b1Res.success).toBe(true);
    s.branch1TaskId = b1Res.elementId;
  });

  test('S8-Step05: Add second branch task after gateway (should offset)', async () => {
    const b2Res = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:ServiceTask',
        name: 'Handle Rejection',
        afterElementId: s.gatewayId,
      })
    );
    expect(b2Res.success).toBe(true);
    s.branch2TaskId = b2Res.elementId;
  });

  test('S8-Step06: Add end event after first branch', async () => {
    const endRes = parseResult(
      await handleAddElement({
        diagramId: s.diagramId,
        elementType: 'bpmn:EndEvent',
        name: 'Done',
        afterElementId: s.branch1TaskId,
      })
    );
    expect(endRes.success).toBe(true);
    s.endId = endRes.elementId;
  });

  test('S8-Step07: Connect second branch to end event', async () => {
    const connRes = parseResult(
      await handleConnect({
        diagramId: s.diagramId,
        sourceElementId: s.branch2TaskId,
        targetElementId: s.endId,
      })
    );
    expect(connRes.success).toBe(true);
  });

  test('S8-Step08: Verify clean layout without calling layout_bpmn_diagram', async () => {
    // Export and verify the diagram is valid BPMN
    const xmlRes = await handleExportBpmn({
      diagramId: s.diagramId,
      format: 'both',
      skipLint: true,
    });
    const xml = xmlRes.content[0].text;
    const svg = xmlRes.content[1]?.text ?? '';

    // Basic structure checks
    expect(xml).toContain('Review Request');
    expect(xml).toContain('Approved?');
    expect(xml).toContain('Process Approval');
    expect(xml).toContain('Handle Rejection');
    expect(svg).toContain('<svg');

    // Verify all elements have DI coordinates (no missing shapes)
    expect(xml).toContain('BPMNShape');
    expect(xml).toContain('BPMNEdge');

    // Verify the two branches are not overlapping (different Y positions)
    const { getDiagram } = await import('../../src/diagram-manager');
    const state = getDiagram(s.diagramId)!;
    const registry = state.modeler.get('elementRegistry') as any;

    const branch1 = registry.get(s.branch1TaskId);
    const branch2 = registry.get(s.branch2TaskId);
    expect(branch1).toBeDefined();
    expect(branch2).toBeDefined();

    // Branches should be at different Y positions (not overlapping)
    const b1CenterY = branch1.y + branch1.height / 2;
    const b2CenterY = branch2.y + branch2.height / 2;
    expect(
      Math.abs(b1CenterY - b2CenterY),
      'Branch tasks should have different Y positions (not overlapping)'
    ).toBeGreaterThan(20);

    // Branches should be to the right of the gateway
    const gateway = registry.get(s.gatewayId);
    expect(branch1.x).toBeGreaterThan(gateway.x);
    expect(branch2.x).toBeGreaterThan(gateway.x);

    await assertStep(s.diagramId, 'S8-Step08', {
      containsElements: [
        'Start',
        'Review Request',
        'Approved?',
        'Process Approval',
        'Handle Rejection',
        'Done',
      ],
      snapshotFile: 'story-08/step-08.bpmn',
    });
  });
});
