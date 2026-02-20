/**
 * Dry-run layout preview: clones the diagram, runs layout, reports statistics
 * and quality metrics without persisting any changes.
 */
import type { LayoutDiagramArgs } from './layout-diagram';
import { type ToolResult, type DiagramState } from '../../types';
import { requireDiagram, jsonResult, getVisibleElements, getService } from '../helpers';
import { elkLayout, elkLayoutSubset, selectLayoutStrategy } from '../../elk/api';
import {
  generateDiagramId,
  storeDiagram,
  deleteDiagram,
  createModelerFromXml,
} from '../../diagram-manager';
import { applyPixelGridSnap, computeDisplacementStats } from './layout-helpers';
import { computeLayoutQualityMetrics } from './layout-quality-metrics';

/** Run layout on a temp diagram clone and return quality stats (used by dry-run). */
export async function runDryRunLayout(
  tempDiagram: DiagramState,
  args: LayoutDiagramArgs
): Promise<{
  layoutResult: { crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> };
  stats: ReturnType<typeof computeDisplacementStats>;
  qualityMetrics: ReturnType<typeof computeLayoutQualityMetrics>;
  totalElements: number;
}> {
  const {
    direction,
    nodeSpacing,
    layerSpacing,
    scopeElementId,
    preserveHappyPath,
    compactness,
    simplifyRoutes,
    elementIds,
  } = args;
  const rawGridSnap = args.gridSnap;
  const elkGridSnap = typeof rawGridSnap === 'boolean' ? rawGridSnap : undefined;
  const pixelGridSnap = typeof rawGridSnap === 'number' ? rawGridSnap : undefined;
  const tempRegistry = getService(tempDiagram.modeler, 'elementRegistry');

  const originalPositions = new Map<string, { x: number; y: number }>();
  for (const el of getVisibleElements(tempRegistry)) {
    if (el.x !== undefined && el.y !== undefined) {
      originalPositions.set(el.id, { x: el.x, y: el.y });
    }
  }

  let layoutResult: { crossingFlows?: number; crossingFlowPairs?: Array<[string, string]> };
  if (elementIds && elementIds.length > 0) {
    layoutResult = await elkLayoutSubset(tempDiagram, elementIds, {
      direction,
      nodeSpacing,
      layerSpacing,
    });
  } else {
    layoutResult = await elkLayout(tempDiagram, {
      direction,
      nodeSpacing,
      layerSpacing,
      scopeElementId,
      preserveHappyPath,
      gridSnap: elkGridSnap,
      compactness,
      simplifyRoutes,
    });
  }
  if (pixelGridSnap && pixelGridSnap > 0) applyPixelGridSnap(tempDiagram, pixelGridSnap);

  const stats = computeDisplacementStats(originalPositions, tempRegistry);
  // K3: include quality metrics in dry-run output so callers can gauge the
  // improvement without applying the layout.
  const qualityMetrics = computeLayoutQualityMetrics(tempRegistry);
  const totalElements = getVisibleElements(tempRegistry).filter(
    (el: any) =>
      !el.type.includes('SequenceFlow') &&
      !el.type.includes('MessageFlow') &&
      !el.type.includes('Association')
  ).length;

  return { layoutResult, stats, qualityMetrics, totalElements };
}

/** Perform a dry-run layout: clone → layout → diff → discard clone. */
export async function handleDryRunLayout(args: LayoutDiagramArgs): Promise<ToolResult> {
  const { diagramId } = args;
  const diagram = requireDiagram(diagramId);
  const { xml } = await diagram.modeler.saveXML({ format: true });

  // K2: Analyse and report the recommended layout strategy.
  const strategyAnalysis = selectLayoutStrategy(diagram);

  const tempId = generateDiagramId();
  const modeler = await createModelerFromXml(xml || '');
  storeDiagram(tempId, { modeler, xml: xml || '', name: `_dryrun_${diagramId}` });

  try {
    const tempDiagram: DiagramState = { modeler, xml: xml || '' };
    const { layoutResult, stats, qualityMetrics, totalElements } = await runDryRunLayout(
      tempDiagram,
      args
    );

    const crossingCount = layoutResult.crossingFlows ?? 0;
    const isLargeChange = stats.movedCount > totalElements * 0.5 && stats.maxDisplacement > 200;

    return jsonResult({
      success: true,
      dryRun: true,
      totalElements,
      movedCount: stats.movedCount,
      maxDisplacement: stats.maxDisplacement,
      avgDisplacement: stats.avgDisplacement,
      ...(crossingCount > 0 ? { crossingFlows: crossingCount } : {}),
      // K2: Expose the recommended layout strategy so callers can understand
      // which pipeline will be selected and why.
      recommendedStrategy: {
        strategy: strategyAnalysis.strategy,
        reason: strategyAnalysis.reason,
        confidence: strategyAnalysis.confidence,
        stats: strategyAnalysis.stats,
      },
      qualityMetrics: {
        avgFlowLength: qualityMetrics.avgFlowLength,
        orthogonalFlowPercent: qualityMetrics.orthogonalFlowPercent,
        elementDensity: qualityMetrics.elementDensity,
        avgBendCount: qualityMetrics.avgBendCount,
        alignedElementPercent: qualityMetrics.alignedElementPercent,
      },
      ...(isLargeChange
        ? {
            warning: `Layout would move ${stats.movedCount}/${totalElements} elements with max displacement of ${stats.maxDisplacement}px. Consider using scopeElementId or elementIds for a more targeted layout.`,
          }
        : {}),
      topDisplacements: stats.displacements,
      message: `Dry run: layout would move ${stats.movedCount}/${totalElements} elements (max ${stats.maxDisplacement}px, avg ${stats.avgDisplacement}px). Call without dryRun to apply.`,
    });
  } finally {
    deleteDiagram(tempId);
  }
}
