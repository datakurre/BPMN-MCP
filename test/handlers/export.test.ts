import { describe, it, expect, beforeEach } from 'vitest';
import { handleExportBpmn, handleConnect } from '../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../helpers';

describe('handleExportBpmn', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  // ── XML format ──────────────────────────────────────────────────────────

  it('returns BPMN XML when format is xml', async () => {
    const diagramId = await createDiagram();
    const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    expect(res.content[0].text).toContain('<bpmn:definitions');
  });

  it('returns SVG when format is svg', async () => {
    const diagramId = await createDiagram();
    const res = await handleExportBpmn({ diagramId, format: 'svg', skipLint: true });
    expect(res.content[0].text).toContain('<svg');
  });

  // ── Connectivity warnings ───────────────────────────────────────────────

  it('warns when elements are disconnected', async () => {
    const diagramId = await createDiagram();
    await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });
    await addElement(diagramId, 'bpmn:EndEvent', { x: 300, y: 100 });

    const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    expect(res.content.length).toBeGreaterThan(1);
    expect(res.content[1].text).toContain('flows');
  });

  // ── Implicit lint (skipLint: false — default) ───────────────────────────

  it('blocks export when lint errors exist', async () => {
    const diagramId = await createDiagram();
    // Add a start event with no end event — "end-event-required" is an error
    await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });

    const res = await handleExportBpmn({ diagramId, format: 'xml' });
    // Should be blocked
    expect(res.content[0].text).toContain('Export blocked');
    expect(res.content[0].text).toContain('lint issue');
  });

  it('exports successfully when diagram is valid', async () => {
    const diagramId = await createDiagram();
    const start = await addElement(diagramId, 'bpmn:StartEvent', {
      name: 'Start',
      x: 100,
      y: 100,
    });
    const end = await addElement(diagramId, 'bpmn:EndEvent', { name: 'End', x: 300, y: 100 });
    await handleConnect({ diagramId, sourceElementId: start, targetElementId: end });

    const res = await handleExportBpmn({ diagramId, format: 'xml' });
    // Should export normally — no "Export blocked"
    expect(res.content[0].text).toContain('<bpmn:definitions');
  });

  it('skipLint: true bypasses lint validation', async () => {
    const diagramId = await createDiagram();
    // Invalid diagram — no end event
    await addElement(diagramId, 'bpmn:StartEvent', { x: 100, y: 100 });

    const res = await handleExportBpmn({ diagramId, format: 'xml', skipLint: true });
    // Should export despite lint errors
    expect(res.content[0].text).toContain('<bpmn:definitions');
  });
});
