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
 * Build a map of element-id to subprocess-id for each element that is a direct
 * child of a bpmn:subProcess (expanded subprocess) in the process definition.
 * Only one level of nesting is handled (sufficient for Camunda Modeler compat).
 */
function buildSubprocessChildMap(xml: string): Map<string, string> {
  const childToSubprocess = new Map<string, string>();
  const diIdx = xml.indexOf('<bpmndi:BPMNDiagram');
  const processPart = diIdx > 0 ? xml.slice(0, diIdx) : xml;

  const subRe = /<bpmn:subProcess\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/bpmn:subProcess>/g;
  let sm: RegExpExecArray | null;
  while ((sm = subRe.exec(processPart)) !== null) {
    const subId = sm[1];
    const childIdRe = /\bid="([^"]+)"/g;
    let cm: RegExpExecArray | null;
    while ((cm = childIdRe.exec(sm[2])) !== null) {
      childToSubprocess.set(cm[1], subId);
    }
  }
  return childToSubprocess;
}

type PlaneChild = {
  lead: string;
  body: string;
  bpmnId: string;
  orderIdx: number;
  isShape: boolean;
  subprocessParentId: string | null;
};

/** Parse all BPMNShape/BPMNEdge children from the BPMNPlane content string. */
function parsePlaneChildren(
  planeContent: string,
  orderMap: Map<string, number>,
  subprocessChildMap: Map<string, string>
): { children: PlaneChild[]; lastEnd: number } {
  const childRe = /( *)(<bpmndi:BPMN(?:Shape|Edge)\b[\s\S]*?<\/bpmndi:BPMN(?:Shape|Edge)>)/g;
  const children: PlaneChild[] = [];
  let lastEnd = 0;
  let cm: RegExpExecArray | null;
  while ((cm = childRe.exec(planeContent)) !== null) {
    const bpmnId = cm[2].match(/bpmnElement="([^"]+)"/)?.[1] ?? '';
    children.push({
      lead: cm[1],
      body: cm[2],
      bpmnId,
      orderIdx: orderMap.get(bpmnId) ?? Number.MAX_SAFE_INTEGER,
      isShape: cm[2].startsWith('<bpmndi:BPMNShape'),
      subprocessParentId: subprocessChildMap.get(bpmnId) ?? null,
    });
    lastEnd = childRe.lastIndex;
  }
  return { children, lastEnd };
}

/**
 * Build the Camunda Modeler DFS output order from parsed plane children.
 *
 * Order: outer shapes (by orderIdx), each followed immediately by its
 * subprocess children (shapes-first within the subprocess), then outer edges.
 */
function buildDfsOrder(children: PlaneChild[]): PlaneChild[] {
  const outerShapes = children
    .filter((c) => c.isShape && c.subprocessParentId === null)
    .sort((a, b) => a.orderIdx - b.orderIdx);
  const outerEdges = children
    .filter((c) => !c.isShape && c.subprocessParentId === null)
    .sort((a, b) => a.orderIdx - b.orderIdx);

  const subGroups = new Map<string, { shapes: PlaneChild[]; edges: PlaneChild[] }>();
  for (const c of children) {
    if (c.subprocessParentId === null) continue;
    let g = subGroups.get(c.subprocessParentId);
    if (!g) {
      g = { shapes: [], edges: [] };
      subGroups.set(c.subprocessParentId, g);
    }
    (c.isShape ? g.shapes : g.edges).push(c);
  }
  for (const g of subGroups.values()) {
    g.shapes.sort((a, b) => a.orderIdx - b.orderIdx);
    g.edges.sort((a, b) => a.orderIdx - b.orderIdx);
  }

  const sorted: PlaneChild[] = [];
  for (const shape of outerShapes) {
    sorted.push(shape);
    const sub = subGroups.get(shape.bpmnId);
    if (sub) sorted.push(...sub.shapes, ...sub.edges);
  }
  sorted.push(...outerEdges);
  return sorted;
}

/**
 * Normalise the order of DI shape/edge elements inside the bpmndi:BPMNPlane
 * block to match Camunda Modeler's convention:
 *
 *   - Outer (top-level) shapes appear first, sorted by process-definition order.
 *   - For each expanded subprocess shape, its DI children (shapes first, then
 *     edges, each sorted by process-definition order) are inserted immediately
 *     after the subprocess's own DI shape.
 *   - Outer edges appear last, sorted by process-definition order.
 *
 * After modeling.moveElements, bpmn-js may re-order the internal plane
 * element list, inserting recently-moved shapes at unexpected positions.
 * This post-processes the XML string directly for a reliable, deterministic
 * result.  If already in the correct order the XML is returned unchanged.
 */
export function normalizePlaneElementOrder(xml: string): string {
  try {
    // Collaboration diagrams have multiple BPMNPlane blocks (one per pool) and
    // complex cross-plane element ordering - bpmn-js already emits these in a
    // stable order, so skip normalisation to avoid regressions.
    if (xml.includes('<bpmn:collaboration')) return xml;

    const orderMap = buildOrderMapFromXml(xml);
    const subprocessChildMap = buildSubprocessChildMap(xml);

    const planeOpenMatch = xml.match(/<bpmndi:BPMNPlane\b[^>]*>/);
    if (!planeOpenMatch) return xml;
    const planeTagStart = xml.indexOf(planeOpenMatch[0]);
    const planeContentStart = planeTagStart + planeOpenMatch[0].length;
    const planeEnd = xml.indexOf('</bpmndi:BPMNPlane>');
    if (planeEnd < 0) return xml;

    const planeContent = xml.slice(planeContentStart, planeEnd);
    const { children, lastEnd } = parsePlaneChildren(planeContent, orderMap, subprocessChildMap);
    if (children.length === 0) return xml;

    const sorted = buildDfsOrder(children);
    const needsSort = sorted.some((c, i) => c.bpmnId !== children[i].bpmnId);

    // Normalise trailing whitespace: collapse double newline before closing tag.
    // bpmn-js sometimes emits an extra blank line; collapsing reduces diffs.
    const trailingGap = planeContent.slice(lastEnd);
    const normalisedTrailing = trailingGap.replace(/^\n+/, '\n');
    if (!needsSort && normalisedTrailing === trailingGap) return xml;

    const indent = children[0].lead;
    const firstMatch = planeContent.indexOf(children[0].lead + children[0].body);
    const leadingGap = firstMatch > 0 ? planeContent.slice(0, firstMatch) : '';
    const sortedBlock = sorted.map((c) => indent + c.body.trim()).join('\n');

    return (
      xml.slice(0, planeContentStart) +
      leadingGap +
      sortedBlock +
      normalisedTrailing +
      xml.slice(planeEnd)
    );
  } catch {
    return xml;
  }
}
