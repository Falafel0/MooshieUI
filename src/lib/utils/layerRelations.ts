/**
 * Layer relationships describe input composition and inpaint conditioning.
 * They never turn a region or a ControlNet into a generation pass.
 *
 * This module deliberately has no store, canvas or network dependencies: a
 * submission can resolve the same relationships from an immutable snapshot.
 */
export type RelationLayerType = "raster" | "mask" | "region" | "controlnet";

export interface ModifierScope {
  mode: "auto" | "document" | "masks";
  /** An explicit empty whitelist means no masks, never the whole document. */
  maskIds?: readonly string[];
}

export interface LayerRelationFields {
  groupId?: string | null;
  /** Intersect painted coverage with transformed, intrinsic raster alpha. */
  targetRasterId?: string | null;
  /** Clip raster pixels with painted mask alpha, independently of mask runs. */
  clippingMaskId?: string | null;
  clippingEnabled?: boolean;
  /** Use one rendered raster as ControlNet input, not as an extra pass. */
  referenceRasterId?: string | null;
  modifierScope?: ModifierScope;
}

/** Shared store/project metadata contract. */
export type LayerRelations = LayerRelationFields;

export interface RelationLayer extends LayerRelationFields {
  id: string;
  type: RelationLayerType;
  visible: boolean;
  controlnet?: { enabled: boolean };
}

export interface LayerGroup {
  id: string;
  name: string;
  visible: boolean;
  /** Organization-only UI state; ignored by the project's dirty signature. */
  collapsed?: boolean;
}

export type LayerBindingField = "targetRasterId" | "clippingMaskId" | "referenceRasterId";
export type LayerRelationIssueCode =
  | "duplicate_layer_id"
  | "duplicate_group_id"
  | "missing_group"
  | "invalid_role"
  | "missing_target"
  | "invalid_target_role"
  | "invalid_scope";

export interface LayerRelationIssue {
  layerId: string;
  code: LayerRelationIssueCode;
  field: LayerBindingField | "clippingEnabled" | "id" | "groupId" | "modifierScope";
  targetId?: string;
}

export type LayerRelationEdgeKind =
  | "group-member"
  | "edit-area"
  | "raster-clipping"
  | "controlnet-reference"
  | "modifier-target";

export interface LayerRelationEdge {
  fromId: string;
  toId: string;
  kind: LayerRelationEdgeKind;
  valid: boolean;
  /** A preserved binding can be valid while its effect is disabled. */
  active: boolean;
}

export interface ResolvedModifierScope {
  layerId: string;
  mode: ModifierScope["mode"];
  enabled: boolean;
  /** Existing intended targets, including targets temporarily disabled. */
  boundMaskIds: string[];
  /** Only existing, enabled mask passes are included. */
  targetMaskIds: string[];
  /** Missing or wrong-role explicit targets stay visible for repair in the UI. */
  unresolvedMaskIds: string[];
}

export interface LayerRelationPlan {
  edges: LayerRelationEdge[];
  modifiers: ResolvedModifierScope[];
  issues: LayerRelationIssue[];
}

const BINDING_FIELDS: readonly LayerBindingField[] = ["targetRasterId", "clippingMaskId", "referenceRasterId"];
const BINDING_KINDS: Record<LayerBindingField, LayerRelationEdgeKind> = {
  targetRasterId: "edit-area",
  clippingMaskId: "raster-clipping",
  referenceRasterId: "controlnet-reference",
};

export function isModifier(layer: Pick<RelationLayer, "type">): boolean {
  return layer.type === "region" || layer.type === "controlnet";
}

function uniqueLayer(id: string, layers: readonly RelationLayer[]): RelationLayer | null {
  const matches = layers.filter(layer => layer.id === id);
  return matches.length === 1 ? matches[0] : null;
}

function uniqueGroup(id: string, groups: readonly LayerGroup[]): LayerGroup | null {
  const matches = groups.filter(group => group.id === id);
  return matches.length === 1 ? matches[0] : null;
}

/** Missing explicit groups fail closed; membership never silently becomes global. */
export function effectiveVisibility(layer: RelationLayer, groups: readonly LayerGroup[] = []): boolean {
  if (!layer.visible || (layer.type === "controlnet" && layer.controlnet?.enabled === false)) return false;
  return layer.groupId == null || uniqueGroup(layer.groupId, groups)?.visible === true;
}

export const effectiveLayerVisibility = effectiveVisibility;

function bindingRoles(field: LayerBindingField): { sources: readonly RelationLayerType[]; target: RelationLayerType } {
  if (field === "targetRasterId") return { sources: ["mask", "region"], target: "raster" };
  if (field === "clippingMaskId") return { sources: ["raster"], target: "mask" };
  return { sources: ["controlnet"], target: "raster" };
}

/** Resolve a binding by both id and role, regardless of the source's UI visibility. */
export function layerRelationTarget(
  layer: RelationLayer,
  field: LayerBindingField,
  layers: readonly RelationLayer[],
): RelationLayer | null {
  const id = layer[field];
  const roles = bindingRoles(field);
  if (id == null || !roles.sources.includes(layer.type)) return null;
  const target = uniqueLayer(id, layers);
  return target?.type === roles.target ? target : null;
}

/**
 * A missing active alpha/reference source must not widen an edit, reveal the
 * unclipped raster, or replace a ControlNet reference with the document.
 */
export function hasUsableLayerBindings(layer: RelationLayer, layers: readonly RelationLayer[]): boolean {
  return BINDING_FIELDS.every(field => {
    if (layer[field] == null) return true;
    if (field === "clippingMaskId" && layer.type === "raster" && layer.clippingEnabled === false) return true;
    return layerRelationTarget(layer, field, layers) !== null;
  });
}

function validScope(scope: ModifierScope | undefined): boolean {
  if (!scope) return true;
  if (scope.mode !== "auto" && scope.mode !== "document" && scope.mode !== "masks") return false;
  return scope.maskIds === undefined || (Array.isArray(scope.maskIds) && scope.maskIds.every(id => typeof id === "string" && id.length > 0));
}

function scopeIncludesMask(modifier: RelationLayer, mask: RelationLayer): boolean {
  const scope = modifier.modifierScope;
  if (scope?.mode === "masks") return scope.maskIds?.includes(mask.id) === true;
  if (scope?.mode === "document") return true;
  return modifier.groupId == null || modifier.groupId === mask.groupId;
}

/**
 * Grouping defines the default scope, not a separate generation chain. Explicit
 * document/whitelist scopes override it; disabling the modifier keeps its scope.
 */
export function modifierAppliesToMask(
  modifier: RelationLayer,
  maskId: string,
  layers: readonly RelationLayer[],
  groups: readonly LayerGroup[] = [],
): boolean {
  const mask = uniqueLayer(maskId, layers);
  if (!isModifier(modifier) || mask?.type !== "mask" || !validScope(modifier.modifierScope)) return false;
  if (!effectiveVisibility(modifier, groups) || !effectiveVisibility(mask, groups)) return false;
  if (!hasUsableLayerBindings(modifier, layers) || !hasUsableLayerBindings(mask, layers)) return false;
  return scopeIncludesMask(modifier, mask);
}

/** Check persisted role/reference invariants without rewriting user intent. */
export function validateLayerRelations(
  layers: readonly RelationLayer[],
  groups: readonly LayerGroup[] = [],
): LayerRelationIssue[] {
  const issues: LayerRelationIssue[] = [];
  const seenLayers = new Set<string>();
  const seenGroups = new Set<string>();
  for (const group of groups) {
    if (seenGroups.has(group.id)) issues.push({ layerId: group.id, code: "duplicate_group_id", field: "id" });
    seenGroups.add(group.id);
  }
  for (const layer of layers) {
    if (seenLayers.has(layer.id)) issues.push({ layerId: layer.id, code: "duplicate_layer_id", field: "id" });
    seenLayers.add(layer.id);
    if (layer.groupId != null && !uniqueGroup(layer.groupId, groups)) {
      issues.push({ layerId: layer.id, code: "missing_group", field: "groupId", targetId: layer.groupId });
    }
    for (const field of BINDING_FIELDS) {
      const id = layer[field];
      if (id == null) continue;
      const roles = bindingRoles(field);
      if (!roles.sources.includes(layer.type)) {
        issues.push({ layerId: layer.id, code: "invalid_role", field, targetId: id });
        continue;
      }
      const target = uniqueLayer(id, layers);
      if (!target) issues.push({ layerId: layer.id, code: "missing_target", field, targetId: id });
      else if (target.type !== roles.target) issues.push({ layerId: layer.id, code: "invalid_target_role", field, targetId: id });
    }
    if (layer.clippingEnabled !== undefined && layer.type !== "raster") {
      issues.push({ layerId: layer.id, code: "invalid_role", field: "clippingEnabled" });
    }
    if (layer.modifierScope !== undefined && (!isModifier(layer) || !validScope(layer.modifierScope))) {
      issues.push({ layerId: layer.id, code: "invalid_scope", field: "modifierScope" });
      continue;
    }
    if (layer.modifierScope?.mode === "masks") {
      for (const id of new Set(layer.modifierScope.maskIds ?? [])) {
        const target = uniqueLayer(id, layers);
        if (!target) issues.push({ layerId: layer.id, code: "missing_target", field: "modifierScope", targetId: id });
        else if (target.type !== "mask") issues.push({ layerId: layer.id, code: "invalid_target_role", field: "modifierScope", targetId: id });
      }
    }
  }
  return issues;
}

/** Typed edges let the layer list/canvas visualize actual relationships and counts. */
export function buildLayerRelationPlan(
  layers: readonly RelationLayer[],
  groups: readonly LayerGroup[] = [],
): LayerRelationPlan {
  const edges: LayerRelationEdge[] = [];
  const modifiers: ResolvedModifierScope[] = [];
  for (const layer of layers) {
    if (layer.groupId != null) {
      edges.push({ fromId: layer.id, toId: layer.groupId, kind: "group-member", valid: !!uniqueGroup(layer.groupId, groups), active: effectiveVisibility(layer, groups) });
    }
    for (const field of BINDING_FIELDS) {
      const targetId = layer[field];
      if (targetId == null) continue;
      const valid = layerRelationTarget(layer, field, layers) !== null;
      edges.push({ fromId: layer.id, toId: targetId, kind: BINDING_KINDS[field], valid,
        active: valid && effectiveVisibility(layer, groups) && (field !== "clippingMaskId" || layer.clippingEnabled !== false) });
    }
    if (!isModifier(layer)) continue;
    const targetMaskIds = layers.filter(mask => modifierAppliesToMask(layer, mask.id, layers, groups)).map(mask => mask.id);
    const boundMaskIds = validScope(layer.modifierScope)
      ? layers.filter(mask => mask.type === "mask" && uniqueLayer(mask.id, layers) && scopeIncludesMask(layer, mask)).map(mask => mask.id) : [];
    const explicitIds = layer.modifierScope?.mode === "masks" && validScope(layer.modifierScope)
      ? [...new Set(layer.modifierScope.maskIds ?? [])] : [];
    const unresolvedMaskIds = explicitIds.filter(id => uniqueLayer(id, layers)?.type !== "mask");
    modifiers.push({ layerId: layer.id, mode: layer.modifierScope?.mode ?? "auto",
      enabled: effectiveVisibility(layer, groups) && validScope(layer.modifierScope) && hasUsableLayerBindings(layer, layers),
      boundMaskIds, targetMaskIds, unresolvedMaskIds });
    for (const id of new Set([...boundMaskIds, ...explicitIds])) {
      const valid = uniqueLayer(id, layers)?.type === "mask";
      edges.push({ fromId: layer.id, toId: id, kind: "modifier-target", valid, active: targetMaskIds.includes(id) });
    }
  }
  return { edges, modifiers, issues: validateLayerRelations(layers, groups) };
}

/**
 * Rebase a saved/duplicated document in two passes: allocate every id first,
 * then remap every relationship with the same maps. Unknown explicit ids are
 * retained as broken references instead of becoming an unsafe global scope.
 */
export function remapLayerRelations<T extends RelationLayer>(
  layer: T,
  layerIds: ReadonlyMap<string, string>,
  groupIds: ReadonlyMap<string, string> = new Map(),
): T {
  const result = { ...layer, id: layerIds.get(layer.id) ?? layer.id };
  if (layer.groupId != null) result.groupId = groupIds.get(layer.groupId) ?? layer.groupId;
  for (const field of BINDING_FIELDS) {
    const id = layer[field];
    if (id != null) result[field] = layerIds.get(id) ?? id;
  }
  if (layer.modifierScope) {
    result.modifierScope = { ...layer.modifierScope,
      ...(layer.modifierScope.maskIds ? { maskIds: layer.modifierScope.maskIds.map(id => layerIds.get(id) ?? id) } : {}) };
  }
  return result;
}
