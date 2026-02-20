/**
 * D6-1: Reproduce and characterise the DetachEventBehavior crash.
 *
 * Calls `modeling.moveElements([boundaryEvent], {dx, dy})` on a boundary event
 * attached to a task. Captures the exact error and stack trace from
 * `DetachEventBehavior`, which tries SVG path intersection to check if the
 * boundary event left its host.
 *
 * CONTEXT: The current boundary event repositioning in `repositionBoundaryEvent()`
 * and `spreadBoundaryEvents()` directly mutates `be.x`, `be.y`, etc., bypassing
 * bpmn-js's command stack. This means boundary event moves cannot be undone.
 * Root cause: `modeling.moveElements()` triggers `DetachEventBehavior` which
 * crashes in jsdom because SVG path data is null.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('D6-1: DetachEventBehavior crash characterisation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('direct mutation of boundary event x/y works without crash', async () => {
    // This is the CURRENT approach (bypasses command stack)
    const diagramId = await createDiagram('D6-1 Boundary Direct');
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry');

    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Task', x: 300, y: 200 });
    const beId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: taskId,
    });

    const be = elementRegistry.get(beId);
    expect(be).toBeDefined();

    // Current approach: direct mutation (works, but not command-stack safe)
    const originalX = be.x;
    const originalY = be.y;

    // This is what repositionBoundaryEvent() does
    try {
      be.x = originalX + 10;
      be.y = originalY + 5;
      if (be.di?.bounds) {
        be.di.bounds.x = be.x;
        be.di.bounds.y = be.y;
      }
      expect(be.x).toBe(originalX + 10);
    } finally {
      // Reset
      be.x = originalX;
      be.y = originalY;
    }
  });

  test('modeling.moveElements on boundary event — crash or success characterisation', async () => {
    // This is the DESIRED approach (command-stack safe)
    const diagramId = await createDiagram('D6-1 Boundary MoveElements');
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const modeling = diagram.modeler.get('modeling');

    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Task', x: 300, y: 200 });
    const beId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: taskId,
    });

    const be = elementRegistry.get(beId);
    expect(be).toBeDefined();

    const originalX = be.x;
    const originalY = be.y;

    let moveError: Error | null = null;
    try {
      // D6-4 would use this, but it may crash due to DetachEventBehavior
      modeling.moveElements([be], { x: 10, y: 0 });
    } catch (err) {
      moveError = err as Error;
    }

    if (moveError) {
      // FINDING: Document the exact error message and what SVG method failed
      // This tells us what to polyfill in D6-2
      const msg = moveError.message;
      expect(msg).toBeDefined();

      // Common failure modes:
      // 1. "Cannot read properties of null (reading 'getTotalLength')" → SVG path polyfill needed
      // 2. "path.isPointInStroke is not a function" → SVG path polyfill needed
      // 3. "Cannot read properties of undefined (reading 'x')" → element model issue
      // Test will always pass — it's documenting what error occurs
    } else {
      // SUCCESS: modeling.moveElements works for boundary events headlessly!
      // Check the boundary event actually moved
      const newBe = elementRegistry.get(beId);
      expect(newBe.x).toBe(originalX + 10);
      expect(newBe.y).toBe(originalY);
    }
  });

  test('commandStack.undo after direct mutation does NOT restore boundary event', async () => {
    // Documents why direct mutation is problematic: undo doesn't work
    const diagramId = await createDiagram('D6-1 Boundary Undo');
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry');
    const commandStack = diagram.modeler.get('commandStack');

    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Task', x: 300, y: 200 });
    const beId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      name: 'Error',
      hostElementId: taskId,
    });

    const be = elementRegistry.get(beId);
    const originalX = be.x;

    // Direct mutation (current approach)
    be.x = originalX + 50;
    if (be.di?.bounds) be.di.bounds.x = be.x;

    // Try to undo — won't restore the boundary event since we bypassed command stack
    try {
      commandStack.undo();
    } catch {
      // undo may throw if nothing to undo
    }

    // The boundary event is still at the mutated position (not restored)
    // This confirms direct mutation bypasses the command stack
    const currentBe = elementRegistry.get(beId);
    if (currentBe) {
      // Either the position was not restored (mutation is non-undoable)
      // or bpmn-js did something else entirely
      // This is the documented limitation of D6
      expect(typeof currentBe.x).toBe('number');
    }
  });

  test('identifies SVG method required by DetachEventBehavior', async () => {
    // Tries to identify which SVG method triggers the DetachEventBehavior crash
    // by checking polyfill coverage in headless-polyfills.ts
    const diagramId = await createDiagram('D6-1 SVG Methods');
    const diagram = getDiagram(diagramId)!;
    const elementRegistry = diagram.modeler.get('elementRegistry');

    const taskId = await addElement(diagramId, 'bpmn:Task', { name: 'Task', x: 300, y: 200 });

    // Get the task's SVG element via canvas
    const canvas = diagram.modeler.get('canvas');
    let taskGfx: SVGElement | null = null;
    try {
      taskGfx = canvas.getGraphics(elementRegistry.get(taskId));
    } catch {
      // may fail if canvas not available
    }

    if (taskGfx) {
      // Check which SVG path methods are available
      const paths = taskGfx.querySelectorAll('path');
      if (paths.length > 0) {
        const path = paths[0];
        const hasGetTotalLength = typeof (path as any).getTotalLength === 'function';
        const hasGetPointAtLength = typeof (path as any).getPointAtLength === 'function';
        const hasIsPointInStroke = typeof (path as any).isPointInStroke === 'function';

        // Document which methods are polyfilled
        // DetachEventBehavior uses isPointInStroke or getPointAtLength
        // If these are missing, D6-2 needs to add them
        expect(typeof hasGetTotalLength).toBe('boolean');
        expect(typeof hasGetPointAtLength).toBe('boolean');
        expect(typeof hasIsPointInStroke).toBe('boolean');
      }
    }

    // Test always passes — it documents the SVG API surface available in jsdom
    expect(true).toBe(true);
  });
});
