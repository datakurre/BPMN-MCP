import { describe, test, expect, beforeEach } from 'vitest';
import { handleAnalyzeLanes } from '../../../src/handlers/collaboration/analyze-lanes';
import { handleCreateParticipant } from '../../../src/handlers';
import { parseResult, createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('analyze_bpmn_lanes — facade routing', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('mode "suggest" routes to suggest-lane-organization handler', async () => {
    const diagramId = await createDiagram();
    const partRes = parseResult(await handleCreateParticipant({ diagramId, name: 'Main' }));
    const participantId = partRes.participantId;
    await addElement(diagramId, 'bpmn:UserTask', {
      name: 'Review',
      participantId,
    });

    const result = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'suggest', participantId })
    );

    // suggest mode returns lane suggestions with a groupingStrategy
    expect(result.suggestions).toBeDefined();
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  test('mode "validate" routes to validate-lane-organization handler', async () => {
    const diagramId = await createDiagram();
    const partRes = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'Main',
        lanes: [{ name: 'Lane A' }, { name: 'Lane B' }],
      })
    );
    const participantId = partRes.participantId;

    const result = parseResult(
      await handleAnalyzeLanes({ diagramId, mode: 'validate', participantId })
    );

    // validate mode returns coherence metrics
    expect(typeof result.coherenceScore).toBe('number');
  });

  test('mode "pool-vs-lanes" routes to suggest-pool-vs-lanes handler', async () => {
    const diagramId = await createDiagram();
    await handleCreateParticipant({
      diagramId,
      participants: [{ name: 'Customer' }, { name: 'Support' }],
    });

    const result = parseResult(await handleAnalyzeLanes({ diagramId, mode: 'pool-vs-lanes' }));

    // pool-vs-lanes mode returns a recommendation
    expect(result.recommendation).toBeDefined();
    expect(['pools', 'lanes', 'mixed']).toContain(result.recommendation);
  });

  test('rejects missing required args', async () => {
    await expect(handleAnalyzeLanes({ diagramId: 'x' } as any)).rejects.toThrow(/Missing required/);
  });
});
