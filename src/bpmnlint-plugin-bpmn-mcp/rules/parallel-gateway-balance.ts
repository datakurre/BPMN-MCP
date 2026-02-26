/**
 * Custom bpmnlint rule: parallel-gateway-balance
 *
 * Every parallel split gateway (1 incoming, 2+ outgoing) should have
 * a matching parallel join gateway where ALL outgoing branches converge.
 * If one or more branches terminate (e.g. at an EndEvent) without
 * reaching the join, the join gateway will deadlock waiting for tokens
 * that never arrive.
 *
 * This rule traces each outgoing branch of a parallel split forward
 * and checks whether all branches reach the same join gateway.
 * Branches that terminate at an EndEvent or dead-end without reaching
 * a join are reported.
 */

import { isType } from '../utils';

/**
 * Walk forward from a node through outgoing sequence flows, looking
 * for a parallel gateway that acts as a join (not a pure split).
 * A "potential join" is a ParallelGateway that has at most 1 outgoing
 * flow — i.e. it converges branches rather than splitting them.
 * We use ≤1 outgoing (not ≥2 incoming) because in the unbalanced case,
 * the join may only have 1 incoming because the missing branch was
 * never connected.
 */
function findForwardParallelJoin(node: any, visited: Set<string>): any | null {
  if (!node || visited.has(node.id)) return null;
  visited.add(node.id);

  // Found a parallel gateway that looks like a join (not a pure split)
  if (isType(node, 'bpmn:ParallelGateway') && (node.outgoing?.length || 0) <= 1) {
    return node;
  }

  // Dead-end: EndEvent or no outgoing flows
  if (isType(node, 'bpmn:EndEvent')) return null;
  const outgoing: any[] = node.outgoing || [];
  if (outgoing.length === 0) return null;

  // Follow each outgoing flow
  for (const flow of outgoing) {
    const target = flow.targetRef;
    if (target) {
      const join = findForwardParallelJoin(target, visited);
      if (join) return join;
    }
  }

  return null;
}

function ruleFactory() {
  function check(node: any, reporter: any) {
    // Only check at process/subprocess level
    if (!isType(node, 'bpmn:Process') && !isType(node, 'bpmn:SubProcess')) return;

    const flowElements = node.flowElements || [];

    // Find parallel split gateways (≤1 incoming, 2+ outgoing)
    const parallelSplits = flowElements.filter(
      (el: any) =>
        isType(el, 'bpmn:ParallelGateway') &&
        (el.incoming?.length || 0) <= 1 &&
        (el.outgoing?.length || 0) >= 2
    );

    for (const split of parallelSplits) {
      const outgoing: any[] = split.outgoing || [];
      const branchJoins: Array<{ branchTarget: string; join: any | null }> = [];

      for (const flow of outgoing) {
        const target = flow.targetRef;
        if (!target) {
          branchJoins.push({ branchTarget: 'unknown', join: null });
          continue;
        }
        const join = findForwardParallelJoin(target, new Set([split.id]));
        branchJoins.push({ branchTarget: target.name || target.id, join });
      }

      // Check: do all branches reach the same join?
      const joinsFound = branchJoins.filter((b) => b.join !== null);
      const missingBranches = branchJoins.filter((b) => b.join === null);

      if (missingBranches.length > 0 && joinsFound.length > 0) {
        // Some branches reach a join, others don't — unbalanced
        const missing = missingBranches.map((b) => b.branchTarget).join(', ');
        reporter.report(
          split.id,
          `Parallel split gateway has ${outgoing.length} outgoing branches, ` +
            `but branch(es) via ${missing} do not reach the join gateway — ` +
            `the parallel join will deadlock waiting for missing tokens. ` +
            `Connect all branches to the join, or use an inclusive gateway if branches are optional.`
        );
      } else if (joinsFound.length >= 2) {
        // All branches reach a join — check they reach the SAME join
        const uniqueJoinIds = new Set(joinsFound.map((b) => b.join.id));
        if (uniqueJoinIds.size > 1) {
          reporter.report(
            split.id,
            `Parallel split gateway branches converge at different join gateways ` +
              `(${Array.from(uniqueJoinIds).join(', ')}). ` +
              `All branches of a parallel split should converge at a single join gateway.`
          );
        }
      }
    }
  }

  return { check };
}

export default ruleFactory;
