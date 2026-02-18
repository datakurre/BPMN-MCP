/**
 * Export helper utilities shared between export.ts and other handlers.
 */

/**
 * Build an ID→index order map by parsing the process-definition section of
 * raw BPMN XML.  This avoids relying on the in-memory `flowElements` array
 * which bpmn-js reorders after `modeling.moveElements()`.
 *
 * Extracts every `id="..."` attribute that appears before the
 * `<bpmndi:BPMNDiagram` section, preserving document order.
 */
function buildOrderMapFromXml(xml: string): Map<string, number> {
  const orderMap = new Map<string, number>();
  const diIdx = xml.indexOf('<bpmndi:BPMNDiagram');
  const processPart = diIdx > 0 ? xml.slice(0, diIdx) : xml;

  let idx = 0;
  const idRe = /\bid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(processPart)) !== null) {
    const id = m[1];
    if (!orderMap.has(id)) orderMap.set(id, idx++);
  }
  return orderMap;
}

/**
 * Normalise the order of DI shape/edge elements inside the `<bpmndi:BPMNPlane>`
 * block to match Camunda Modeler's convention:
 *   1. All BPMNShape elements first, sorted by process-definition order.
 *   2. All BPMNEdge elements after, sorted by process-definition order.
 *
 * After `modeling.moveElements`, bpmn-js may re-order the internal plane
 * element list, inserting recently-moved shapes at unexpected positions.
 * This post-processes the XML string directly for a reliable, deterministic
 * result.  If already in the correct order the XML is returned unchanged.
 */
export function normalizePlaneElementOrder(xml: string): string {
  try {
    // Collaboration diagrams have multiple BPMNPlane blocks (one per pool) and
    // complex cross-plane element ordering — bpmn-js already emits these in a
    // stable order, so skip normalisation to avoid regressions.
    if (xml.includes('<bpmn:collaboration')) return xml;

    const orderMap = buildOrderMapFromXml(xml);

    const planeOpenMatch = xml.match(/<bpmndi:BPMNPlane\b[^>]*>/);
    if (!planeOpenMatch) return xml;

    const planeTagStart = xml.indexOf(planeOpenMatch[0]);
    const planeContentStart = planeTagStart + planeOpenMatch[0].length;
    const planeEnd = xml.indexOf('</bpmndi:BPMNPlane>');
    if (planeEnd < 0) return xml;

    const planeContent = xml.slice(planeContentStart, planeEnd);

    // Match each BPMNShape or BPMNEdge child element with its leading whitespace.
    const childRe = /( *)(<bpmndi:BPMN(?:Shape|Edge)\b[\s\S]*?<\/bpmndi:BPMN(?:Shape|Edge)>)/g;

    const children: Array<{ lead: string; body: string; orderIdx: number; isShape: boolean }> = [];
    let lastEnd = 0;
    let cm: RegExpExecArray | null;
    childRe.lastIndex = 0;
    while ((cm = childRe.exec(planeContent)) !== null) {
      const lead = cm[1];
      const body = cm[2];
      const bpmnIdMatch = body.match(/bpmnElement="([^"]+)"/);
      const bpmnId = bpmnIdMatch?.[1] ?? '';
      const orderIdx = orderMap.has(bpmnId) ? orderMap.get(bpmnId)! : Number.MAX_SAFE_INTEGER;
      const isShape = body.startsWith('<bpmndi:BPMNShape');
      children.push({ lead, body, orderIdx, isShape });
      lastEnd = childRe.lastIndex;
    }

    if (children.length === 0) return xml;

    // Camunda Modeler sort: shapes first (by orderIdx), then edges (by orderIdx).
    // Sort key: (0=shape / 1=edge, orderIdx)
    const sortKey = (c: { orderIdx: number; isShape: boolean }) =>
      (c.isShape ? 0 : 1) * 1_000_000 + c.orderIdx;

    // Check if already in the correct order
    let needsSort = false;
    for (let i = 1; i < children.length; i++) {
      if (sortKey(children[i]) < sortKey(children[i - 1])) {
        needsSort = true;
        break;
      }
    }

    // Use the first child's leading whitespace as the canonical indent
    const indent = children[0]?.lead ?? '      ';

    // Locate where matched children begin/end in planeContent
    const firstMatch = planeContent.indexOf(children[0].lead + children[0].body);
    const leadingGap = firstMatch > 0 ? planeContent.slice(0, firstMatch) : '';
    const trailingGap = planeContent.slice(lastEnd);

    // Normalise the trailing gap (whitespace between last child and </bpmndi:BPMNPlane>)
    // to a single newline + indent, matching Camunda Modeler's convention.
    // bpmn-js sometimes emits an extra blank line there; collapsing it reduces diffs.
    const normalisedTrailing = trailingGap.replace(/^\n+/, '\n');

    // If order is already correct and trailing gap is unchanged, skip reconstruction
    if (!needsSort && normalisedTrailing === trailingGap) return xml;

    // Stable sort: shapes before edges, each group sorted by process def order
    const sorted = needsSort ? [...children].sort((a, b) => sortKey(a) - sortKey(b)) : children;

    const sortedBlock = sorted.map((c) => indent + c.body.trim()).join('\n');

    const before = xml.slice(0, planeContentStart);
    const after = xml.slice(planeEnd);
    return before + leadingGap + sortedBlock + normalisedTrailing + after;
  } catch {
    return xml;
  }
}
