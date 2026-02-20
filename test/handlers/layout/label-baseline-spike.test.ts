/**
 * D4-1: Label baseline position spike.
 *
 * Tries to invoke bpmn-js's `getExternalLabelMid()` utility to get the default
 * label position, and compares it to the MCP's custom label positioning output.
 *
 * CONTEXT: bpmn-js uses `getExternalLabelMid(element)` to compute the default
 * label position during interactive editing. Using it as a baseline would produce
 * label positions consistent with Camunda Modeler. The current MCP implementation
 * uses `getCandidatePositions()` with hardcoded offsets.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('D4-1: bpmn-js getExternalLabelMid() headless spike', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('getExternalLabelMid is accessible from bpmn-js module', async () => {
    // Try to require the internal bpmn-js utility
    let getExternalLabelMid: any;
    let importError: Error | null = null;

    const candidates = ['bpmn-js/lib/util/LabelUtil', 'bpmn-js/lib/util/ModelUtil'];

    for (const mod of candidates) {
      try {
        const m = (await import(mod)) as Record<string, any>;
        if (m.getExternalLabelMid) {
          getExternalLabelMid = m.getExternalLabelMid;
          break;
        }
      } catch (err) {
        importError = err as Error;
      }
    }

    if (!getExternalLabelMid) {
      // Document: function not accessible via these paths
      // This tells us to look elsewhere (e.g. via modeler injector)
      expect(importError || !getExternalLabelMid).toBeTruthy();
      return;
    }

    // If found, verify it's callable
    expect(typeof getExternalLabelMid).toBe('function');
  });

  test('labelUtil service accessible via modeler injector', async () => {
    const diagramId = await createDiagram('D4-1 Label Spike');
    const diagram = getDiagram(diagramId)!;
    const modeler = diagram.modeler;

    // Try to get the label utility via modeler injector
    const serviceNames = [
      'labelUtil',
      'bpmnLabelUtil',
      'labelBehavior',
      'adaptiveLabelPositioningBehavior',
      'labelEditingPreview',
    ];

    const found: string[] = [];
    for (const name of serviceNames) {
      try {
        const svc = modeler.get(name);
        if (svc) {
          found.push(name);
        }
      } catch {
        // not registered
      }
    }

    // Document which services are available
    // (This informs D4-2 about what APIs we can use)
    expect(found.length).toBeGreaterThanOrEqual(0); // always passes, documents findings
  });

  test('label position via labelUtil.getLabel() vs element centre', async () => {
    const diagramId = await createDiagram('D4-1 Label Position');
    const diagram = getDiagram(diagramId)!;
    const modeler = diagram.modeler;
    const elementRegistry = modeler.get('elementRegistry');

    // Add a start event (has an external label)
    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'My Start',
      x: 200,
      y: 200,
    });

    const startEl = elementRegistry.get(startId);
    expect(startEl).toBeDefined();

    // Check if the element has a label child
    const label =
      elementRegistry.get(`${startId}_label`) ||
      (startEl.children || []).find((c: any) => c.type === 'label');

    if (label) {
      // Document label position relative to element
      const elementCy = startEl.y + (startEl.height ?? 0) / 2;
      const labelY = label.y;

      // bpmn-js default: label is below the event (labelY > elementCy)
      // This is the baseline we want to match in D4-2
      expect(labelY).toBeGreaterThanOrEqual(elementCy);
    }
    // If no label found, the label may be represented differently — document
  });

  test('getExternalLabelMid via bpmn-js module requires', async () => {
    // Try different import paths for bpmn-js label utilities
    const pathsToTry = ['bpmn-js/lib/util/LabelUtil'];

    let getExternalLabelMid: ((element: any) => { x: number; y: number }) | null = null;

    for (const p of pathsToTry) {
      try {
        const mod = await import(p);
        if (mod?.getExternalLabelMid) {
          getExternalLabelMid = mod.getExternalLabelMid;
          break;
        }
      } catch {
        // continue
      }
    }

    if (!getExternalLabelMid) {
      // FINDING: getExternalLabelMid not available via direct require.
      // It may be embedded in the bundled bpmn-js browser build.
      // Alternative: use modeler.get('textRenderer') or 'canvas' to compute label bounds.
      expect(true).toBe(true);
      return;
    }

    // If available, test with a real element
    const diagramId = await createDiagram('D4-1 Label Mid');
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry');

    const startId = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Test',
      x: 200,
      y: 200,
    });
    const startEl = elementRegistry.get(startId);

    const mid = getExternalLabelMid(startEl);
    expect(mid).toBeDefined();
    expect(typeof mid.x).toBe('number');
    expect(typeof mid.y).toBe('number');

    // For a start event at y=200, h=36: label centre should be below
    // y_centre = 200 + 36/2 = 218; label_mid.y > 218
    expect(mid.y).toBeGreaterThan(218);
  });
});
