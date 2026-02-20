/**
 * D4-4: Label positions match bpmn-js defaults for simple diagrams.
 *
 * Verifies that after layout, external labels are placed consistent with
 * bpmn-js's `getExternalLabelMid()` convention:
 *   label centre Y = element.bottom + DEFAULT_LABEL_SIZE.height / 2 (= element.bottom + 10)
 *   label rect.y   = element.bottom + DEFAULT_LABEL_SIZE.height / 2 - lh / 2
 *
 * For the standard label height of 20 px this simplifies to:
 *   label rect.y = element.bottom  (label touches element's bottom edge)
 *
 * Since `getExternalLabelMid` is not directly importable in Node.js
 * (bpmn-js is bundled as an ES module), the expected positions are computed
 * from the same formula used by bpmn-js and compared with 15 px tolerance.
 *
 * Run with: npx vitest run test/handlers/layout/label-alignment.test.ts
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  createDiagram,
  addElement,
  connect,
  clearDiagrams,
  extractLabelPositionsFromBpmn,
  extractBpmnPositions,
} from '../../helpers';
import { handleLayoutDiagram, handleExportBpmn } from '../../../src/handlers';

// D4-4 tolerance: 15 px (matches spec)
const LABEL_TOLERANCE = 15;
const DEFAULT_LABEL_HEIGHT = 20; // DEFAULT_LABEL_SIZE.height from bpmn-js

/** Compute the bpmn-js default label rect top for an element at the bottom position. */
function expectedBottomLabelY(
  elementY: number,
  elementHeight: number,
  labelHeight: number
): number {
  // bpmn-js: label centre at element.bottom + DEFAULT_LABEL_SIZE.height / 2
  // label rect.y = centre - lh / 2 = element.bottom + 10 - lh/2
  return elementY + elementHeight + DEFAULT_LABEL_HEIGHT / 2 - labelHeight / 2;
}

describe('D4-4: Label positions match bpmn-js defaults', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('start event label is within 15px of bpmn-js bottom convention', async () => {
    // Create: Start → Task → End
    const diagramId = await createDiagram('D4-4 Label Alignment Start Event');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Process Started',
      x: 200,
      y: 200,
    });
    const taskId = await addElement(diagramId, 'bpmn:Task', {
      name: 'Do Work',
      x: 380,
      y: 182,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Process Ended',
      x: 560,
      y: 200,
    });
    await connect(diagramId, startId, taskId);
    await connect(diagramId, taskId, endId);

    await handleLayoutDiagram({ diagramId });
    const result = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = result.content[0].text;

    const shapePositions = extractBpmnPositions(xml);
    const labelPositions = extractLabelPositionsFromBpmn(xml);

    const startShape = shapePositions.get(startId);
    const startLabel = labelPositions.get(startId);
    expect(startShape, 'start event shape not found').toBeDefined();
    expect(startLabel, 'start event label not found').toBeDefined();

    const expected = expectedBottomLabelY(startShape!.y, startShape!.height, startLabel!.height);
    const actual = startLabel!.y;
    expect(
      Math.abs(actual - expected),
      `Start event label Y=${actual} expected ~${expected} (diff=${actual - expected})`
    ).toBeLessThanOrEqual(LABEL_TOLERANCE);
  });

  test('end event label is within 15px of bpmn-js bottom convention', async () => {
    const diagramId = await createDiagram('D4-4 Label Alignment End Event');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 200,
      y: 200,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', {
      name: 'Order Completed',
      x: 380,
      y: 200,
    });
    await connect(diagramId, startId, endId);

    await handleLayoutDiagram({ diagramId });
    const result = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = result.content[0].text;

    const shapePositions = extractBpmnPositions(xml);
    const labelPositions = extractLabelPositionsFromBpmn(xml);

    const endShape = shapePositions.get(endId);
    const endLabel = labelPositions.get(endId);
    expect(endShape, 'end event shape not found').toBeDefined();
    expect(endLabel, 'end event label not found').toBeDefined();

    const expected = expectedBottomLabelY(endShape!.y, endShape!.height, endLabel!.height);
    const actual = endLabel!.y;
    expect(
      Math.abs(actual - expected),
      `End event label Y=${actual} expected ~${expected} (diff=${actual - expected})`
    ).toBeLessThanOrEqual(LABEL_TOLERANCE);
  });

  test('gateway label is placed (informational position logged)', async () => {
    // Gateway labels are repositioned by AdaptiveLabelPositioningBehavior.
    // We check that the label exists and is within a generous 30px of the
    // bpmn-js bottom default, since scoring may move it above if connections
    // cross the bottom position.
    const diagramId = await createDiagram('D4-4 Label Alignment Gateway');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 200,
      y: 200,
    });
    const gwId = await addElement(diagramId, 'bpmn:ExclusiveGateway', {
      name: 'Approved?',
      x: 380,
      y: 193,
    });
    const yesId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'Yes', x: 560, y: 175 });
    const noId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'No', x: 560, y: 235 });
    await connect(diagramId, startId, gwId);
    await connect(diagramId, gwId, yesId);
    await connect(diagramId, gwId, noId);

    await handleLayoutDiagram({ diagramId });
    const result = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = result.content[0].text;

    const shapePositions = extractBpmnPositions(xml);
    const labelPositions = extractLabelPositionsFromBpmn(xml);

    const gwShape = shapePositions.get(gwId);
    const gwLabel = labelPositions.get(gwId);
    expect(gwShape, 'gateway shape not found').toBeDefined();
    expect(gwLabel, 'gateway label not found').toBeDefined();

    // Log for informational purposes
    const bottomExpected = expectedBottomLabelY(gwShape!.y, gwShape!.height, gwLabel!.height);
    const actual = gwLabel!.y;
    console.error(
      `Gateway label: Y=${actual}, bottom-convention expected ~${bottomExpected}, diff=${actual - bottomExpected}`
    );

    // Gateway label should be within 30px of either top or bottom bpmn-js position.
    // The scoring algorithm may legitimately choose top over bottom when connections block it.
    const topExpected = gwShape!.y - gwLabel!.height;
    const distBottom = Math.abs(actual - bottomExpected);
    const distTop = Math.abs(actual - topExpected);
    expect(
      Math.min(distBottom, distTop),
      `Gateway label Y=${actual} is more than 30px from both top (${topExpected}) and bottom (${bottomExpected})`
    ).toBeLessThanOrEqual(30);
  });

  test('intermediate event label is within 15px of bpmn-js bottom convention', async () => {
    const diagramId = await createDiagram('D4-4 Label Alignment Intermediate Event');
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 200,
      y: 200,
    });
    const catchId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent', {
      name: 'Timer Elapsed',
      x: 380,
      y: 200,
    });
    const endId = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 560, y: 200 });
    await connect(diagramId, startId, catchId);
    await connect(diagramId, catchId, endId);

    await handleLayoutDiagram({ diagramId });
    const result = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    const xml = result.content[0].text;

    const shapePositions = extractBpmnPositions(xml);
    const labelPositions = extractLabelPositionsFromBpmn(xml);

    const catchShape = shapePositions.get(catchId);
    const catchLabel = labelPositions.get(catchId);
    expect(catchShape, 'catch event shape not found').toBeDefined();
    expect(catchLabel, 'catch event label not found').toBeDefined();

    const expected = expectedBottomLabelY(catchShape!.y, catchShape!.height, catchLabel!.height);
    const actual = catchLabel!.y;
    expect(
      Math.abs(actual - expected),
      `Intermediate event label Y=${actual} expected ~${expected} (diff=${actual - expected})`
    ).toBeLessThanOrEqual(LABEL_TOLERANCE);
  });

  test('label rect.y equals element.bottom for standard 20px label height', () => {
    // Unit test: verify the formula directly without needing a full layout.
    // For lh=20: label rect.y = element.bottom + 10 - 10 = element.bottom
    const elementY = 150;
    const elementHeight = 36;
    const elementBottom = elementY + elementHeight; // 186

    const labelHeight = 20; // DEFAULT_LABEL_SIZE.height
    const expected = expectedBottomLabelY(elementY, elementHeight, labelHeight);
    expect(expected).toBe(elementBottom); // 186 + 10 - 10 = 186
  });

  test('label centre matches bpmn-js getExternalLabelMid formula', () => {
    // Verify: label_centre.y = element.bottom + DEFAULT_LABEL_SIZE.height / 2
    const elementY = 100;
    const elementHeight = 36;
    const elementBottom = elementY + elementHeight; // 136

    const labelHeight = 14; // non-standard height
    const rectY = expectedBottomLabelY(elementY, elementHeight, labelHeight);
    // rectY = 136 + 10 - 7 = 139
    const labelCentreY = rectY + labelHeight / 2;
    // centre = 139 + 7 = 146 = element.bottom + 10 ✓
    expect(labelCentreY).toBe(elementBottom + DEFAULT_LABEL_HEIGHT / 2);
  });
});
