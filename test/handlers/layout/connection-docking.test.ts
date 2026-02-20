/**
 * D1-6: CroppingConnectionDocking endpoint perimeter tests.
 *
 * Verifies that getCroppedWaypoints() places endpoints on shape boundaries.
 * COORDINATE NOTE: addElement(x, y) centers the element at (x, y).
 * getCroppedWaypoints returns {x, y} (cropped position) + {original} (centre).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createDiagram, addElement, connect, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

function getConnectionDocking(modeler: any): any | null {
  try {
    return modeler.get('connectionDocking');
  } catch {
    return null;
  }
}

describe('D1-6: CroppingConnectionDocking endpoint placement', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('getCroppedWaypoints service available and returns ≥2 waypoints', async () => {
    const id = await createDiagram('D1-6 Basic');
    const { modeler } = getDiagram(id)!;
    const er = modeler.get('elementRegistry');
    const s = await addElement(id, 'bpmn:StartEvent', { x: 150, y: 200 });
    const t = await addElement(id, 'bpmn:Task', { x: 350, y: 200 });
    const cId = await connect(id, s, t);
    const docking = getConnectionDocking(modeler);
    expect(docking).not.toBeNull();
    const cropped = docking.getCroppedWaypoints(er.get(cId));
    expect(Array.isArray(cropped)).toBe(true);
    expect(cropped.length).toBeGreaterThanOrEqual(2);
  });

  test('StartEvent → Task: first wp is on event right perimeter (not centre)', async () => {
    // Element centered at (150,200), w=36: right edge at element.x+width=168
    const id = await createDiagram('D1-6 Start-Task');
    const { modeler } = getDiagram(id)!;
    const er = modeler.get('elementRegistry');
    const sId = await addElement(id, 'bpmn:StartEvent', { x: 150, y: 200 });
    const tId = await addElement(id, 'bpmn:Task', { x: 350, y: 200 });
    const cId = await connect(id, sId, tId);
    const docking = getConnectionDocking(modeler);
    if (!docking) return;
    const cropped = docking.getCroppedWaypoints(er.get(cId));
    const start = er.get(sId);
    const task = er.get(tId);
    // CROPPED positions use .x/.y directly (not .original which is the centre)
    const firstX = cropped[0].x as number;
    const lastX = cropped[cropped.length - 1].x as number;
    // Start right edge = start.x + start.width (element.x is top-left)
    expect(Math.abs(firstX - (start.x + (start.width ?? 36)))).toBeLessThan(5);
    // Task left edge = task.x
    expect(Math.abs(lastX - task.x)).toBeLessThan(5);
    // Cropped endpoint should NOT be at element centre
    const startCx = start.x + (start.width ?? 36) / 2;
    expect(Math.abs(firstX - startCx)).toBeGreaterThan(5);
    // .original contains the uncropped centre
    if (cropped[0].original) {
      expect(Math.abs((cropped[0].original.x as number) - startCx)).toBeLessThan(5);
    }
  });

  test('ExclusiveGateway → Task: endpoint at gateway right vertex', async () => {
    // Gateway centered at (300,200), w=50: right vertex at gwCx + w/2
    const id = await createDiagram('D1-6 GW-Task');
    const { modeler } = getDiagram(id)!;
    const er = modeler.get('elementRegistry');
    const gwId = await addElement(id, 'bpmn:ExclusiveGateway', { x: 300, y: 200 });
    const tId = await addElement(id, 'bpmn:Task', { x: 500, y: 200 });
    const cId = await connect(id, gwId, tId);
    const docking = getConnectionDocking(modeler);
    if (!docking) return;
    const cropped = docking.getCroppedWaypoints(er.get(cId));
    const gw = er.get(gwId);
    const firstX = cropped[0].x as number;
    const gwCx = gw.x + (gw.width ?? 50) / 2;
    // Right vertex of diamond = gwCx + width/2
    const gwRightVertex = gwCx + (gw.width ?? 50) / 2;
    expect(Math.abs(firstX - gwRightVertex)).toBeLessThan(5);
    expect(Math.abs(firstX - gwCx)).toBeGreaterThan(5);
  });

  test('Task → EndEvent: last waypoint on event left perimeter', async () => {
    const id = await createDiagram('D1-6 Task-End');
    const { modeler } = getDiagram(id)!;
    const er = modeler.get('elementRegistry');
    const tId = await addElement(id, 'bpmn:Task', { x: 200, y: 200 });
    const eId = await addElement(id, 'bpmn:EndEvent', { x: 400, y: 200 });
    const cId = await connect(id, tId, eId);
    const docking = getConnectionDocking(modeler);
    if (!docking) return;
    const cropped = docking.getCroppedWaypoints(er.get(cId));
    const end = er.get(eId);
    const lastX = cropped[cropped.length - 1].x as number;
    // EndEvent left edge = end.x (top-left corner)
    expect(Math.abs(lastX - end.x)).toBeLessThan(5);
    // Should not be at end event centre
    const endCx = end.x + (end.width ?? 36) / 2;
    expect(Math.abs(lastX - endCx)).toBeGreaterThan(5);
  });

  test('cropped endpoints are closer to boundary than original (centre) positions', async () => {
    const id = await createDiagram('D1-6 Closer');
    const { modeler } = getDiagram(id)!;
    const er = modeler.get('elementRegistry');
    const sId = await addElement(id, 'bpmn:StartEvent', { x: 150, y: 200 });
    const tId = await addElement(id, 'bpmn:Task', { x: 350, y: 200 });
    const cId = await connect(id, sId, tId);
    const docking = getConnectionDocking(modeler);
    if (!docking) return;
    const cropped = docking.getCroppedWaypoints(er.get(cId));
    const start = er.get(sId);
    const task = er.get(tId);
    const firstCroppedX = cropped[0].x as number;
    const firstOrigX = (cropped[0].original?.x ?? firstCroppedX) as number;
    const lastCroppedX = cropped[cropped.length - 1].x as number;
    const lastOrigX = (cropped[cropped.length - 1].original?.x ?? lastCroppedX) as number;
    // Start right edge: cropped should be ≤ distance of original to right edge
    const startRight = start.x + (start.width ?? 36);
    expect(Math.abs(firstCroppedX - startRight)).toBeLessThanOrEqual(
      Math.abs(firstOrigX - startRight)
    );
    // Task left edge: cropped should be ≤ distance of original to left edge
    const taskLeft = task.x;
    expect(Math.abs(lastCroppedX - taskLeft)).toBeLessThanOrEqual(Math.abs(lastOrigX - taskLeft));
  });

  test('all BPMN shape types: getCroppedWaypoints returns ≥2 waypoints', async () => {
    const id = await createDiagram('D1-6 AllTypes');
    const { modeler } = getDiagram(id)!;
    const er = modeler.get('elementRegistry');
    const docking = getConnectionDocking(modeler);
    if (!docking) return;
    const types = [
      { type: 'bpmn:StartEvent', x: 150, y: 200 },
      { type: 'bpmn:Task', x: 350, y: 200 },
      { type: 'bpmn:ExclusiveGateway', x: 550, y: 200 },
      { type: 'bpmn:UserTask', x: 750, y: 200 },
      { type: 'bpmn:EndEvent', x: 950, y: 200 },
    ];
    const ids: string[] = [];
    for (const s of types) ids.push(await addElement(id, s.type, { x: s.x, y: s.y }));
    for (let i = 0; i < ids.length - 1; i++) {
      const cId = await connect(id, ids[i], ids[i + 1]);
      const cropped = docking.getCroppedWaypoints(er.get(cId));
      expect(cropped.length).toBeGreaterThanOrEqual(2);
    }
  });
});
