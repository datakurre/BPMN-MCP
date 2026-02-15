/**
 * Script property handling for set_bpmn_element_properties.
 *
 * Extracted to keep set-properties.ts within lint line limits.
 * Handles scriptFormat, script (inline body), and camunda:resource
 * on ScriptTask elements.
 */

import { getService } from '../helpers';

const CAMUNDA_RESOURCE = 'camunda:resource';
const CAMUNDA_RESULT_VAR = 'camunda:resultVariable';

/**
 * Handle `scriptFormat` + `script` + optional `camunda:resource` — sets inline script content
 * on ScriptTask elements. Mutates `standardProps` and `camundaProps` in-place.
 * Returns true if script properties were handled.
 */
export function handleScriptProperties(
  element: any,
  standardProps: Record<string, any>,
  camundaProps: Record<string, any>,
  diagram: any
): boolean {
  const hasScriptFormat = 'scriptFormat' in standardProps;
  const hasScript = 'script' in standardProps;
  const hasResource = CAMUNDA_RESOURCE in camundaProps;

  if (!hasScriptFormat && !hasScript && !hasResource) return false;

  const bo = element.businessObject;
  if (!bo.$type.includes('ScriptTask')) return false;

  const modeling = getService(diagram.modeler, 'modeling');

  if (hasScriptFormat) {
    modeling.updateProperties(element, { scriptFormat: standardProps['scriptFormat'] });
    delete standardProps['scriptFormat'];
  }

  if (hasScript) {
    bo.script = standardProps['script'];
    delete standardProps['script'];
    if (bo[CAMUNDA_RESOURCE]) {
      modeling.updateProperties(element, { [CAMUNDA_RESOURCE]: undefined });
    }
  }

  if (hasResource) {
    modeling.updateProperties(element, { [CAMUNDA_RESOURCE]: camundaProps[CAMUNDA_RESOURCE] });
    delete camundaProps[CAMUNDA_RESOURCE];
    if (!hasScript) bo.script = undefined;
  }

  if (CAMUNDA_RESULT_VAR in camundaProps) {
    modeling.updateProperties(element, {
      [CAMUNDA_RESULT_VAR]: camundaProps[CAMUNDA_RESULT_VAR] || undefined,
    });
    delete camundaProps[CAMUNDA_RESULT_VAR];
  }

  return true;
}
