/**
 * Happy path detection for BPMN diagrams.
 *
 * Detects the main flow from a start event to an end event, following
 * default flows at gateways (or the first outgoing flow when no default
 * is set).
 */

import { isConnection, isInfrastructure } from './helpers';

/**
 * Detect the "happy path" — the main flow from a start event to an end
 * event, following default flows at gateways (or the first outgoing flow
 * when no default is set).
 *
 * Returns a Set of connection (edge) IDs that form the happy path.
 */
export function detectHappyPath(allElements: any[]): Set<string> {
  const happyEdgeIds = new Set<string>();

  // Find start events (entry points)
  const startEvents = allElements.filter(
    (el: any) => el.type === 'bpmn:StartEvent' && !isInfrastructure(el.type)
  );
  if (startEvents.length === 0) return happyEdgeIds;

  // Build adjacency: node → outgoing connections
  const outgoing = new Map<string, any[]>();
  for (const el of allElements) {
    if (isConnection(el.type) && el.source && el.target) {
      const list = outgoing.get(el.source.id) || [];
      list.push(el);
      outgoing.set(el.source.id, list);
    }
  }

  // Build a map of gateway default flows (gateway businessObject.default)
  const gatewayDefaults = new Map<string, string>();
  for (const el of allElements) {
    if (el.type?.includes('Gateway') && el.businessObject?.default) {
      gatewayDefaults.set(el.id, el.businessObject.default.id);
    }
  }

  // Walk from each start event, following default/first flows
  const visited = new Set<string>();
  for (const start of startEvents) {
    let current = start;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);

      const connections = outgoing.get(current.id);
      if (!connections || connections.length === 0) break;

      // Pick the preferred outgoing connection:
      // 1. Gateway with default flow → follow the default
      // 2. Otherwise → follow the first connection
      let chosen: any;
      const defaultFlowId = gatewayDefaults.get(current.id);
      if (defaultFlowId) {
        chosen = connections.find((c: any) => c.id === defaultFlowId);
      }
      if (!chosen) {
        chosen = connections[0];
      }

      happyEdgeIds.add(chosen.id);
      current = chosen.target;
    }
  }

  return happyEdgeIds;
}
