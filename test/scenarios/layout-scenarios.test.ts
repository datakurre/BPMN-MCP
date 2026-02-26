/**
 * Parameterised layout scenario test runner.
 *
 * Iterates over all scenarios defined in `builders.ts`, builds each
 * diagram programmatically, runs `layout_bpmn_diagram`, and checks
 * every declared layout expectation.
 *
 * See TODO.md §10c for the design rationale.
 */

import { describe, test, beforeEach } from 'vitest';
import { clearDiagrams, getDiagram } from '../../src/diagram-manager';
import { handleLayoutDiagram } from '../../src/handlers';
import { scenarios } from './builders';

describe('Layout scenarios', () => {
  beforeEach(() => {
    clearDiagrams();
  });

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      test('layout produces expected result', async () => {
        const { diagramId, expectations } = await scenario.build();

        await handleLayoutDiagram({ diagramId });

        const registry = getDiagram(diagramId)!.modeler.get('elementRegistry') as any;

        for (const expectation of expectations) {
          expectation.assert(registry);
        }
      });
    });
  }
});
