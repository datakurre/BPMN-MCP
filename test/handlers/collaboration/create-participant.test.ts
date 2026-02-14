import { describe, test, expect, beforeEach } from 'vitest';
import { handleCreateParticipant, handleCreateCollaboration } from '../../../src/handlers';
import { createDiagram, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('create_bpmn_participant', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('creates a single participant in a fresh diagram', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'Order Service',
      })
    );

    expect(res.success).toBe(true);
    expect(res.participantId).toContain('Participant');
    expect(res.collapsed).toBe(false);
  });

  test('creates a collapsed participant', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'External System',
        collapsed: true,
      })
    );

    expect(res.success).toBe(true);
    expect(res.collapsed).toBe(true);
  });

  test('uses custom processId', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'Main Process',
        processId: 'Process_Main',
      })
    );

    expect(res.success).toBe(true);
    expect(res.processId).toBe('Process_Main');
  });

  test('creates participant with lanes', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'HR Department',
        lanes: [{ name: 'Recruiter' }, { name: 'Manager' }],
      })
    );

    expect(res.success).toBe(true);
    expect(res.laneIds).toHaveLength(2);
  });

  test('rejects duplicate participant ID', async () => {
    const diagramId = await createDiagram();

    await handleCreateParticipant({
      diagramId,
      name: 'Pool A',
      participantId: 'Participant_A',
    });

    await expect(
      handleCreateParticipant({
        diagramId,
        name: 'Pool B',
        participantId: 'Participant_A',
      })
    ).rejects.toThrow(/already exists/);
  });

  test('adds participant below existing ones in collaboration', async () => {
    const diagramId = await createDiagram();

    // Create initial collaboration
    await handleCreateCollaboration({
      diagramId,
      participants: [{ name: 'Pool 1' }, { name: 'Pool 2' }],
    });

    // Add a third participant
    const res = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'Pool 3',
      })
    );

    expect(res.success).toBe(true);
    expect(res.participantId).toContain('Participant');
  });

  test('uses explicit participantId', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'My Pool',
        participantId: 'Participant_Custom',
      })
    );

    expect(res.participantId).toBe('Participant_Custom');
  });

  test('uses dynamic pool sizing when lanes are provided', async () => {
    const diagramId = await createDiagram();

    const res = parseResult(
      await handleCreateParticipant({
        diagramId,
        name: 'HR Department',
        lanes: [{ name: 'Recruiter' }, { name: 'Manager' }, { name: 'Admin' }],
      })
    );

    expect(res.success).toBe(true);

    const diagram = getDiagram(diagramId)!;
    const reg = diagram.modeler.get('elementRegistry') as any;
    const pool = reg.get(res.participantId);

    // Pool with 3 lanes should use dynamic sizing (wider than old default 600)
    expect(pool.width).toBeGreaterThan(600);
  });
});
