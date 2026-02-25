import { describe, test, expect, beforeEach } from 'vitest';
import { handleSetProperties } from '../../../src/handlers';
import { createDiagram, addElement, parseResult, clearDiagrams } from '../../helpers';
import { getDiagram } from '../../../src/diagram-manager';

describe('set_bpmn_element_properties — ScriptTask script handling', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  test('sets scriptFormat and inline script on ScriptTask', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask', { name: 'MyScript' });

    const res = parseResult(
      await handleSetProperties({
        diagramId,
        elementId: taskId,
        properties: {
          scriptFormat: 'groovy',
          script: 'println "Hello"',
        },
      })
    );

    expect(res.success).toBe(true);

    // Verify on the business object
    const diagram = getDiagram(diagramId)!;
    const registry = diagram.modeler.get('elementRegistry');
    const bo = registry.get(taskId).businessObject;
    expect(bo.scriptFormat).toBe('groovy');
    expect(bo.script).toBe('println "Hello"');
  });

  test('sets camunda:resultVariable on ScriptTask', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask');

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        scriptFormat: 'javascript',
        script: 'var x = 1 + 1;',
        'camunda:resultVariable': 'myResult',
      },
    });

    const diagram = getDiagram(diagramId)!;
    const registry = diagram.modeler.get('elementRegistry');
    const bo = registry.get(taskId).businessObject;
    expect(bo.scriptFormat).toBe('javascript');
    expect(bo.script).toBe('var x = 1 + 1;');
    expect(bo.$attrs?.['camunda:resultVariable'] || bo.resultVariable).toBe('myResult');
  });

  test('script is present in exported XML', async () => {
    const diagramId = await createDiagram();
    const taskId = await addElement(diagramId, 'bpmn:ScriptTask');

    await handleSetProperties({
      diagramId,
      elementId: taskId,
      properties: {
        scriptFormat: 'groovy',
        script: 'execution.setVariable("done", true)',
      },
    });

    const diagram = getDiagram(diagramId)!;
    const { xml } = await diagram.modeler.saveXML({ format: true });
    expect(xml).toContain('scriptFormat="groovy"');
    expect(xml).toContain('execution.setVariable("done", true)');
  });
});
