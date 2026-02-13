/**
 * Tests for MCP resources (bpmn:// URIs).
 */
import { describe, test, expect, afterEach } from 'vitest';
import { createDiagram, clearDiagrams, addElement } from './helpers';
import { listResources, readResource, RESOURCE_TEMPLATES } from '../src/resources';

afterEach(() => clearDiagrams());

describe('RESOURCE_TEMPLATES', () => {
  test('has templates for summary, lint, and variables', () => {
    expect(RESOURCE_TEMPLATES).toHaveLength(3);
    const uris = RESOURCE_TEMPLATES.map((t) => t.uriTemplate);
    expect(uris).toContain('bpmn://diagram/{diagramId}/summary');
    expect(uris).toContain('bpmn://diagram/{diagramId}/lint');
    expect(uris).toContain('bpmn://diagram/{diagramId}/variables');
  });
});

describe('listResources', () => {
  test('returns bpmn://diagrams when no diagrams exist', () => {
    const resources = listResources();
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe('bpmn://diagrams');
  });

  test('returns per-diagram resources when diagrams exist', async () => {
    const id = await createDiagram('Test Process');
    const resources = listResources();
    // 1 (diagrams list) + 3 (summary, lint, variables)
    expect(resources).toHaveLength(4);
    const uris = resources.map((r: any) => r.uri);
    expect(uris).toContain('bpmn://diagrams');
    expect(uris).toContain(`bpmn://diagram/${id}/summary`);
    expect(uris).toContain(`bpmn://diagram/${id}/lint`);
    expect(uris).toContain(`bpmn://diagram/${id}/variables`);
  });
});

describe('readResource', () => {
  test('reads bpmn://diagrams', async () => {
    await createDiagram('My Process');
    const result = await readResource('bpmn://diagrams');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');
    const data = JSON.parse(result.contents[0].text);
    expect(data.count).toBe(1);
  });

  test('reads bpmn://diagram/{id}/summary', async () => {
    const id = await createDiagram('Summary Test');
    await addElement(id, 'bpmn:StartEvent', { name: 'Start' });
    const result = await readResource(`bpmn://diagram/${id}/summary`);
    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0].text);
    expect(data.success).toBe(true);
  });

  test('reads bpmn://diagram/{id}/lint', async () => {
    const id = await createDiagram('Lint Test');
    const result = await readResource(`bpmn://diagram/${id}/lint`);
    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0].text);
    expect(data.success).toBe(true);
    expect(typeof data.issueCount).toBe('number');
  });

  test('reads bpmn://diagram/{id}/variables', async () => {
    const id = await createDiagram('Vars Test');
    const result = await readResource(`bpmn://diagram/${id}/variables`);
    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0].text);
    expect(data.success).toBe(true);
  });

  test('throws on unknown URI', async () => {
    await expect(readResource('bpmn://unknown')).rejects.toThrow('Unknown resource URI');
  });

  test('throws on non-existent diagram', async () => {
    await expect(readResource('bpmn://diagram/nonexistent/summary')).rejects.toThrow(
      'Diagram not found'
    );
  });
});
