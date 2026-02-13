import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetEventDefinition } from '../../../src/handlers';
import { createDiagram, addElement, clearDiagrams } from '../../helpers';

describe('set_bpmn_event_definition ref validation', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('rejects messageRef for ErrorEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent');

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        messageRef: { id: 'Msg_1', name: 'Wrong' },
      })
    ).rejects.toThrow(/Invalid argument "messageRef" for bpmn:ErrorEventDefinition/);
  });

  test('rejects signalRef for ErrorEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent');

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        signalRef: { id: 'Sig_1', name: 'Wrong' },
      })
    ).rejects.toThrow(/Invalid argument "signalRef" for bpmn:ErrorEventDefinition/);
  });

  test('rejects errorRef for MessageEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent');

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:MessageEventDefinition',
        errorRef: { id: 'Err_1', name: 'Wrong' },
      })
    ).rejects.toThrow(/Invalid argument "errorRef" for bpmn:MessageEventDefinition/);
  });

  test('rejects errorRef for SignalEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateThrowEvent');

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:SignalEventDefinition',
        errorRef: { id: 'Err_1', name: 'Wrong' },
      })
    ).rejects.toThrow(/Invalid argument "errorRef" for bpmn:SignalEventDefinition/);
  });

  test('rejects messageRef for EscalationEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateThrowEvent');

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:EscalationEventDefinition',
        messageRef: { id: 'Msg_1', name: 'Wrong' },
      })
    ).rejects.toThrow(/Invalid argument "messageRef" for bpmn:EscalationEventDefinition/);
  });

  test('rejects errorRef for TimerEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent');

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:TimerEventDefinition',
        errorRef: { id: 'Err_1', name: 'Wrong' },
        properties: { timeDuration: 'PT1H' },
      })
    ).rejects.toThrow(/Invalid argument "errorRef" for bpmn:TimerEventDefinition/);
  });

  test('accepts correct errorRef for ErrorEventDefinition', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ServiceTask', { name: 'Task' });
    const eventId = await addElement(diagramId, 'bpmn:BoundaryEvent', {
      hostElementId: taskId,
    });

    // Should not throw
    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:ErrorEventDefinition',
        errorRef: { id: 'Err_1', name: 'BusinessError', errorCode: 'ERR_001' },
      })
    ).resolves.toBeDefined();
  });

  test('accepts correct messageRef for MessageEventDefinition', async () => {
    const diagramId = await createDiagram();
    const eventId = await addElement(diagramId, 'bpmn:IntermediateCatchEvent');

    await expect(
      handleSetEventDefinition({
        diagramId,
        elementId: eventId,
        eventDefinitionType: 'bpmn:MessageEventDefinition',
        messageRef: { id: 'Msg_1', name: 'MyMessage' },
      })
    ).resolves.toBeDefined();
  });
});
