/**
 * Tests for hintLevel configuration on diagrams.
 */

import { describe, test, expect, afterEach } from 'vitest';
import { handleCreateDiagram } from '../../../src/handlers/core/create-diagram';
import { parseResult, clearDiagrams } from '../../helpers';

afterEach(() => clearDiagrams());

describe('hintLevel on create_bpmn_diagram', () => {
  test('defaults hintLevel to full', async () => {
    const result = parseResult(await handleCreateDiagram({}));
    expect(result.hintLevel).toBe('full');
    expect(result.draftMode).toBe(false);
  });

  test('sets hintLevel to none', async () => {
    const result = parseResult(await handleCreateDiagram({ hintLevel: 'none' }));
    expect(result.hintLevel).toBe('none');
    expect(result.draftMode).toBe(true);
  });

  test('sets hintLevel to minimal', async () => {
    const result = parseResult(await handleCreateDiagram({ hintLevel: 'minimal' }));
    expect(result.hintLevel).toBe('minimal');
    expect(result.draftMode).toBe(false);
  });

  test('draftMode true implies hintLevel none', async () => {
    const result = parseResult(await handleCreateDiagram({ draftMode: true }));
    expect(result.hintLevel).toBe('none');
    expect(result.draftMode).toBe(true);
  });

  test('explicit hintLevel overrides draftMode', async () => {
    const result = parseResult(
      await handleCreateDiagram({ draftMode: true, hintLevel: 'minimal' })
    );
    expect(result.hintLevel).toBe('minimal');
  });
});
