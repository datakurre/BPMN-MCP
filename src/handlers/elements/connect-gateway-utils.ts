/**
 * Parallel gateway balance check utilities for connect_bpmn_elements.
 * Extracted from connect.ts to stay under max-lines.
 */

/**
 * DFS search for a parallel join gateway reachable from `node`.
 * Returns the join gateway business object, or null if not found.
 */
function findParallelJoin(node: any, visited: Set<string>, depth = 0): any | null {
  if (!node || visited.has(node.id) || depth > 25) return null;
  visited.add(node.id);
  const t: string = node.$type || '';
  // A parallel gateway with ≤1 outgoing flows is a join
  if (t === 'bpmn:ParallelGateway' && (node.outgoing?.length || 0) <= 1) return node;
  // Dead ends — no join reachable from here
  if (t === 'bpmn:EndEvent' || !node.outgoing?.length) return null;
  for (const flow of node.outgoing as any[]) {
    const target = flow.targetRef;
    if (!target) continue;
    const join = findParallelJoin(target, visited, depth + 1);
    if (join) return join;
  }
  return null;
}

/**
 * Check whether all outgoing branches of a parallel split gateway reach
 * a corresponding parallel join gateway.
 *
 * Returns a warning string if any branch terminates without a join,
 * or null when the gateway is balanced (or has <2 outgoing branches).
 */
export function checkParallelGatewayBalance(gatewayBo: any): string | null {
  const outgoing: any[] = gatewayBo.outgoing || [];
  if (outgoing.length < 2) return null;

  const missingBranches: string[] = [];
  for (const flow of outgoing) {
    const target = flow.targetRef;
    if (!target) {
      missingBranches.push('unknown');
      continue;
    }
    const join = findParallelJoin(target, new Set([gatewayBo.id]));
    if (!join) missingBranches.push(target.name || target.id || 'unknown');
  }
  if (missingBranches.length === 0) return null;

  return (
    `⚠️ Parallel gateway "${gatewayBo.name || gatewayBo.id}" has ${outgoing.length} outgoing ` +
    `branches but branch(es) via [${missingBranches.join(', ')}] do not reach a ` +
    `parallel join gateway — the join will deadlock waiting for missing tokens. ` +
    `Connect all branches to the join gateway, or use an inclusive gateway if branches are optional.`
  );
}
