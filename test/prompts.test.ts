/**
 * Tests for MCP prompts.
 */
import { describe, test, expect } from 'vitest';
import { listPrompts, getPrompt } from '../src/prompts';

describe('listPrompts', () => {
  test('returns all prompt definitions', () => {
    const prompts = listPrompts();
    expect(prompts.length).toBeGreaterThanOrEqual(4);
    const names = prompts.map((p) => p.name);
    expect(names).toContain('create-executable-process');
    expect(names).toContain('convert-to-collaboration');
    expect(names).toContain('add-sla-timer-pattern');
    expect(names).toContain('add-approval-pattern');
  });

  test('each prompt has name, title, and description', () => {
    for (const prompt of listPrompts()) {
      expect(prompt.name).toBeTruthy();
      expect(prompt.title).toBeTruthy();
      expect(prompt.description).toBeTruthy();
    }
  });
});

describe('getPrompt', () => {
  test('returns messages for create-executable-process', () => {
    const result = getPrompt('create-executable-process', { processName: 'Order Processing' });
    expect(result.description).toBeTruthy();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content.text).toContain('Order Processing');
    expect(result.messages[0].content.text).toContain('create_bpmn_diagram');
  });

  test('returns messages for convert-to-collaboration', () => {
    const result = getPrompt('convert-to-collaboration', {
      diagramId: 'test-123',
      partners: 'Customer, Payment Gateway',
    });
    expect(result.messages[0].content.text).toContain('test-123');
    expect(result.messages[0].content.text).toContain('Customer, Payment Gateway');
  });

  test('returns messages for add-sla-timer-pattern', () => {
    const result = getPrompt('add-sla-timer-pattern', {
      diagramId: 'd1',
      targetElementId: 'Task_1',
      duration: 'PT2H',
    });
    expect(result.messages[0].content.text).toContain('PT2H');
    expect(result.messages[0].content.text).toContain('Task_1');
  });

  test('returns messages for add-approval-pattern', () => {
    const result = getPrompt('add-approval-pattern', {
      diagramId: 'd1',
      afterElementId: 'Task_1',
      approverGroup: 'managers',
    });
    expect(result.messages[0].content.text).toContain('managers');
    expect(result.messages[0].content.text).toContain('Task_1');
  });

  test('throws on unknown prompt', () => {
    expect(() => getPrompt('nonexistent')).toThrow('Unknown prompt');
  });

  test('uses defaults for missing arguments', () => {
    const result = getPrompt('create-executable-process', {});
    expect(result.messages[0].content.text).toContain('My Process');
  });
});
