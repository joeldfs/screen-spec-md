/// <reference types="@figma/plugin-typings" />
import { Box, ColorMode, Element, Role } from '../types'

// Read the layer tree of a selected frame into a FLAT list of leaf Elements,
// each with a box (px, relative to the frame's top-left). The wireframe renderer
// places them by those coordinates. Layer/frame names are never used.
//
// Noise handling:
// - skip hidden / zero-opacity nodes; stop at component instances
// - a sibling group that is entirely visual (shapes, no text/instances) collapses
//   to ONE image (or progress) — e.g. concentric circles, a progress track+fill
// - a filled/rounded background rect that contains a short text becomes one Button
//   (covers buttons drawn as a bare rect + text rather than a wrapping frame)
// - drop tiny nodes and full-bleed backgrounds

const MIN_SIZE = 6

interface Ctx {
  maxTextSize: number
  frameWidth: number
  frameHeight: number
  originX: number
  originY: number
  instanceNames: Map<string, string>
  // styleId → role, resolved from named text styles (e.g. "Desktop/Body" → body).
  // A device-independent role signal that augments font-size ranking.
  textStyleRoles: Map<string, Role>
  colorMode: ColorMode
  // variableId / styleId → token name, resolved up front (tokens mode only).
  variableNames: Map<string, string>
  colorStyleNames: Map<string, string>
}

export async function extractScreen(
  frame: SceneNode,
  colorMode: ColorMode
): Promise<{
  elements: Array<Element>
  frameWidth: number
  frameHeight: number
  layout?: Element['layout']
  padding?: Element['padding']
  overflow?: Element['overflow']
}> {
  const instanceNames = await resolveInstanceNames(frame)
  const textStyleRoles = await resolveTextStyleRoles(frame)
  const { variableNames, colorStyleNames } = await resolveColorTokens(
    frame,
    colorMode
  )
  const bounds =
    'absoluteBoundingBox' in frame && frame.absoluteBoundingBox !== null
      ? frame.absoluteBoundingBox
      : { x: 0, y: 0, width: geom(frame).w, height: geom(frame).h }
  const ctx: Ctx = {
    maxTextSize: collectMaxTextSize(frame),
    frameWidth: bounds.width,
    frameHeight: bounds.height,
    originX: bounds.x,
    originY: bounds.y,
    instanceNames,
    textStyleRoles,
    colorMode,
    variableNames,
    colorStyleNames
  }
  const out: Array<Element> = []
  emitContainer(frame, ctx, 0, out, undefined)
  const cleaned = dropDefaultTextColor(
    dropNestedVisuals(dropChartLabels(mergeIconLabels(out)))
  )
  return {
    elements: cleaned,
    frameWidth: ctx.frameWidth,
    frameHeight: ctx.frameHeight,
    layout: layoutIntent(frame),
    padding: paddingOf(frame),
    overflow: overflowOf(frame)
  }
}

// --- emit ------------------------------------------------------------------

function emit(
  node: SceneNode,
  ctx: Ctx,
  depth: number,
  out: Array<Element>,
  parentSourceNodeId: string | undefined
): void {
  if (!isVisible(node) || depth > 12) {
    return
  }
  switch (node.type) {
    case 'TEXT': {
      const text = styledText(node)
      if (text.length > 0) {
        pushElement(out, node, parentSourceNodeId, {
          role: inferTextRole(node, ctx),
          text,
          box: boxOf(node, ctx),
          color: colorOf(node, ctx)
        })
      }
      return
    }
    case 'INSTANCE': {
      const box = boxOf(node, ctx)
      if (isDecorative(node) || box.w < MIN_SIZE || box.h < MIN_SIZE) {
        return
      }
      pushElement(out, node, parentSourceNodeId, instanceElement(node, ctx))
      return
    }
    case 'RECTANGLE':
    case 'ELLIPSE':
    case 'VECTOR':
    case 'STAR':
    case 'POLYGON':
    case 'BOOLEAN_OPERATION':
    case 'LINE': {
      const shape = shapeElement(node, ctx)
      if (shape !== null) {
        pushElement(out, node, parentSourceNodeId, shape)
      }
      return
    }
    case 'FRAME':
    case 'COMPONENT':
    case 'GROUP':
    case 'SECTION': {
      if ((node.type === 'FRAME' || node.type === 'COMPONENT') && isAvatar(node)) {
        pushElement(out, node, parentSourceNodeId, avatarElement(node, ctx))
        return
      }
      if ((node.type === 'FRAME' || node.type === 'COMPONENT') && isInput(node)) {
        pushElement(out, node, parentSourceNodeId, inputElement(node, ctx))
        return
      }
      if ((node.type === 'FRAME' || node.type === 'COMPONENT') && isButton(node, ctx)) {
        pushElement(out, node, parentSourceNodeId, buttonElement(node, ctx))
        return
      }
      // A repeating-row data table collapses to one element (columns + row shape
      // + count) instead of shattering into dozens of cells.
      if (isTabular(node)) {
        pushElement(out, node, parentSourceNodeId, tableElement(node, ctx))
        return
      }
      // A horizontal row of repeating multi-text cards (e.g. KPI cards) collapses
      // to one summary; a filled row of short-text tabs to one `tabs`.
      if (isCardRow(node)) {
        pushElement(out, node, parentSourceNodeId, cardRowElement(node, ctx))
        return
      }
      if (isTabRow(node)) {
        pushElement(out, node, parentSourceNodeId, tabsElement(node, ctx))
        return
      }
      // A plot/illustration (several shapes + only tiny labels, no instances)
      // collapses to one [chart] instead of shattering into ticks and segments.
      if (isChartLike(node)) {
        pushElement(out, node, parentSourceNodeId, {
          role: 'chart',
          box: boxOf(node, ctx),
          rounded: isRoundedShape(node)
        })
        return
      }
      if (!hasContent(node)) {
        const shape = shapeElement(node, ctx)
        if (shape !== null) {
          pushElement(out, node, parentSourceNodeId, shape)
        }
        return
      }
      // A structural frame with explicit auto-layout becomes a group box carrying
      // its direction/gap/alignment — the composition intent the geometry can't
      // show. Children still emit (and draw on top). Instances never reach here,
      // so this only fires for custom scaffolding, where layout is unknown to the
      // LLM.
      const layout = groupLayout(node, ctx, depth)
      if (layout !== undefined) {
        pushElement(out, node, parentSourceNodeId, {
          role: 'group',
          box: boxOf(node, ctx),
          layout,
          padding: paddingOf(node),
          overflow: overflowOf(node)
        })
        emitContainer(node, ctx, depth, out, node.id)
        return
      }
      emitContainer(node, ctx, depth, out, parentSourceNodeId)
      return
    }
    default:
      return
  }
}

function emitContainer(
  node: SceneNode,
  ctx: Ctx,
  depth: number,
  out: Array<Element>,
  parentSourceNodeId: string | undefined
): void {
  const kids = childrenOf(node).filter(isVisible)
  if (kids.length === 0) {
    return
  }
  const horizontal = 'layoutMode' in node && node.layoutMode === 'HORIZONTAL'
  const vertical = 'layoutMode' in node && node.layoutMode === 'VERTICAL'

  if (horizontal && kids.length > 1) {
    emitGroup(sortByX(kids), ctx, depth, out, parentSourceNodeId)
    return
  }
  if (vertical) {
    for (const kid of kids) {
      emit(kid, ctx, depth + 1, out, parentSourceNodeId)
    }
    return
  }
  // No / grid layout: reconstruct reading rows from geometry.
  for (const group of groupRows(kids)) {
    emitGroup(group, ctx, depth, out, parentSourceNodeId)
  }
}

// Process a group of sibling nodes (already left-to-right ordered).
function emitGroup(
  group: Array<SceneNode>,
  ctx: Ctx,
  depth: number,
  out: Array<Element>,
  parentSourceNodeId: string | undefined
): void {
  if (group.length === 1) {
    emit(group[0], ctx, depth, out, parentSourceNodeId)
    return
  }
  if (group.every((node) => !hasContent(node))) {
    const merged = mergedVisual(group, ctx)
    if (merged !== null) {
      pushElement(out, group[0], parentSourceNodeId, merged)
    }
    return
  }
  // Pair background rects with the text they contain → buttons.
  const consumed = new Set<string>()
  const buttonFor = new Map<string, Element>()
  const texts = group.filter((node): node is TextNode => node.type === 'TEXT')
  for (const node of group) {
    if (!isFilledButtonRect(node)) {
      continue
    }
    const label = texts.find(
      (text) =>
        !consumed.has(text.id) &&
        centerInside(text, node) &&
        isShort(text) &&
        inferTextRole(text, ctx) !== 'heading'
    )
    if (label !== undefined) {
      buttonFor.set(node.id, {
        role: buttonRole(node),
        text: cleanText(label.characters),
        box: boxOf(node, ctx),
        rounded: isRoundedShape(node)
      })
      consumed.add(node.id)
      consumed.add(label.id)
    }
  }
  for (const node of group) {
    if (consumed.has(node.id)) {
      const button = buttonFor.get(node.id)
      if (button !== undefined) {
        pushElement(out, node, parentSourceNodeId, button)
      }
      continue
    }
    emit(node, ctx, depth + 1, out, parentSourceNodeId)
  }
}

function pushElement(
  out: Array<Element>,
  node: SceneNode,
  parentSourceNodeId: string | undefined,
  element: Element
): void {
  out.push({
    ...element,
    sourceNodeId: node.id,
    parentSourceNodeId
  })
}

// --- element builders ------------------------------------------------------

function instanceElement(node: InstanceNode, ctx: Ctx): Element {
  const name = ctx.instanceNames.get(node.id) ?? cleanText(node.name)
  const label = cleanText(collectVisibleText(node))
  const icons = collectIcons(node, ctx)
  return {
    role: 'component',
    component: name,
    props: variantProps(node),
    text: label.length > 0 ? label : undefined,
    icons: icons.length > 0 ? icons : undefined,
    box: boxOf(node, ctx),
    rounded: isRoundedShape(node),
    color: colorOf(node, ctx)
  }
}

// The variant-axis selections on an instance (e.g. size=lg, state=default) — the
// "which variant" signal an LLM needs to pick the right repo component. We read
// only VARIANT properties (their keys are clean axis names); boolean/text/swap
// props carry "#id" suffixes and often duplicate the visible text, so they're
// skipped to keep the legend tight.
function variantProps(node: InstanceNode): { [name: string]: string } | undefined {
  let properties: InstanceNode['componentProperties']
  try {
    properties = node.componentProperties
  } catch {
    return undefined
  }
  if (properties === undefined) {
    return undefined
  }
  const out: { [name: string]: string } = {}
  for (const key of Object.keys(properties)) {
    const property = properties[key]
    if (property.type === 'VARIANT') {
      out[key.split('#')[0]] = String(property.value)
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// List the icon children worth naming: icon-sized nested instances (by their
// component name) and icon-sized shapes (as "icon"). Larger sub-components (rows,
// skeletons, headers) and decorative chrome are skipped — this is an icon index,
// not a full child dump. We peek inside but still emit the instance as one box.
function collectIcons(node: SceneNode, ctx: Ctx): Array<string> {
  const icons: Array<string> = []
  const walk = (current: SceneNode, depth: number): void => {
    if (depth > 4 || icons.length >= 12) {
      return
    }
    for (const child of childrenOf(current)) {
      if (!isVisible(child) || isDecorative(child) || icons.length >= 12) {
        continue
      }
      if (child.type === 'INSTANCE') {
        if (isIconSized(child)) {
          icons.push(ctx.instanceNames.get(child.id) ?? cleanText(child.name))
        }
        // Don't recurse into instances — an icon-sized instance is a leaf icon,
        // and a larger one (a row/skeleton) isn't an icon container.
        continue
      }
      if (isIconShape(child)) {
        icons.push(iconName(child) ?? 'icon')
        continue
      }
      walk(child, depth + 1)
    }
  }
  walk(node, 0)
  return icons
}

function buttonElement(node: SceneNode, ctx: Ctx): Element {
  const label = cleanText(collectVisibleText(node))
  return {
    role: buttonRole(node),
    text: label.length > 0 ? label : undefined,
    box: boxOf(node, ctx),
    rounded: isRoundedShape(node),
    color: colorOf(node, ctx)
  }
}

// A small rounded pill (short label, ≲28px tall) is a status/category badge, not
// a button. Otherwise a dark fill is a primary button, else secondary.
function buttonRole(node: SceneNode): Role {
  if (geom(node).h <= 28) {
    return 'badge'
  }
  return isPrimary(node) ? 'button-primary' : 'button-secondary'
}

function shapeElement(node: SceneNode, ctx: Ctx): Element | null {
  const box = boxOf(node, ctx)
  if (box.w < MIN_SIZE || box.h < MIN_SIZE) {
    return null
  }
  if (box.w >= ctx.frameWidth * 0.97 && box.h >= ctx.frameHeight * 0.97) {
    return null
  }
  // No visible paint (and, for frames, no content) → invisible scaffolding, not
  // an image. Drop it instead of emitting a phantom box.
  if (!hasVisiblePaint(node)) {
    return null
  }
  const color = colorOf(node, ctx)
  if (isProgress(box, ctx)) {
    return { role: 'progress', box, color }
  }
  const rounded = isRoundedShape(node)
  if (box.w < 48 && box.h < 48) {
    return { role: 'icon', box, rounded, text: iconName(node) ?? undefined, color }
  }
  return { role: 'image', box, rounded, color }
}

function mergedVisual(group: Array<SceneNode>, ctx: Ctx): Element | null {
  const boxes = group.map((node) => boxOf(node, ctx))
  const box = unionBox(boxes)
  if (box === null || box.w < MIN_SIZE || box.h < MIN_SIZE) {
    return null
  }
  const role: Role = group.some((node) => isProgress(boxOf(node, ctx), ctx))
    ? 'progress'
    : 'image'
  return { role, box, rounded: group.some(isRoundedShape) }
}

// --- de-noise --------------------------------------------------------------

const SHAPE_TYPES: ReadonlyArray<string> = [
  'RECTANGLE',
  'ELLIPSE',
  'VECTOR',
  'STAR',
  'POLYGON',
  'BOOLEAN_OPERATION',
  'LINE'
]
const VECTOR_TYPES: ReadonlyArray<string> = [
  'VECTOR',
  'STAR',
  'POLYGON',
  'BOOLEAN_OPERATION',
  'LINE'
]
const TEXT_ROLES: ReadonlyArray<Role> = [
  'heading',
  'subheading',
  'eyebrow',
  'body',
  'caption'
]

function isShapeNode(node: SceneNode): boolean {
  return SHAPE_TYPES.indexOf(node.type) !== -1
}

function isIconShape(node: SceneNode): boolean {
  return isShapeNode(node) && isIconSized(node)
}

function isIconSized(node: SceneNode): boolean {
  const g = geom(node)
  return Math.max(g.w, g.h) < 48
}

// Default geometry names Figma assigns to shapes — carry no meaning.
const GENERIC_SHAPE_NAME =
  /^(vector|union|subtract|intersect|exclude|rectangle|ellipse|oval|line|star|polygon|boolean|shape|mask|path|icon|frame|group|component)\b/i

// For an icon-sized leaf shape, its layer name is often the only signal of *what*
// the glyph is (e.g. "ArrowUp", "Search"). This is the one place besides
// isDecorative we read a name — and only for bare icon shapes, where the name is
// content. Returns null for generic/auto names so the caller falls back to "icon".
function iconName(node: SceneNode): string | null {
  const name = cleanText(node.name)
  if (name.length === 0 || GENERIC_SHAPE_NAME.test(name)) {
    return null
  }
  return name
}

function isTinyLabel(node: TextNode): boolean {
  const words = node.characters.trim().split(/\s+/).length
  return words <= 3 && textSize(node) <= 14
}

// A drawing (≥3 shapes incl. a vector/line path) annotated only by tiny labels,
// with no instances — i.e. a chart or illustration. Collapsed to one box so the
// axis ticks, gridlines and series don't shatter into dozens of elements.
function isChartLike(node: SceneNode): boolean {
  if (!('children' in node)) {
    return false
  }
  let shapes = 0
  let vectors = 0
  let texts = 0
  let tinyTexts = 0
  let instances = 0
  const walk = (current: SceneNode, depth: number): void => {
    if (depth > 5) {
      return
    }
    for (const child of childrenOf(current)) {
      if (!isVisible(child)) {
        continue
      }
      if (child.type === 'INSTANCE') {
        instances++
        continue
      }
      if (child.type === 'TEXT') {
        if (cleanText(child.characters).length > 0) {
          texts++
          if (isTinyLabel(child)) {
            tinyTexts++
          }
        }
        continue
      }
      if (isShapeNode(child)) {
        shapes++
        if (VECTOR_TYPES.indexOf(child.type) !== -1) {
          vectors++
        }
        continue
      }
      walk(child, depth + 1)
    }
  }
  walk(node, 0)
  return (
    instances === 0 &&
    vectors >= 1 &&
    shapes >= 3 &&
    texts >= 1 &&
    tinyTexts === texts
  )
}

// A container of ≥4 near-uniform rows stacked vertically, each with ≥3 cells — a
// data table. Collapsed to one element so its cells don't shatter into dozens of
// items. A 1–2-cell-per-row list (e.g. a nav) is NOT tabular: its labels are real
// signal, not sample data.
function isTabular(node: SceneNode): boolean {
  if (!('children' in node)) {
    return false
  }
  const rows = childrenOf(node).filter(isVisible)
  if (rows.length < 4) {
    return false
  }
  const heights = rows.map((row) => geom(row).h)
  const med = median(heights)
  if (med <= 0) {
    return false
  }
  const uniform = heights.every((h) => Math.abs(h - med) <= med * 0.4)
  const multiCol = rows.every((row) => cellCount(row) >= 3)
  return uniform && multiCol && verticallyStacked(rows)
}

function tableElement(node: SceneNode, ctx: Ctx): Element {
  const rows = childrenOf(node)
    .filter(isVisible)
    .sort((a, b) => geom(a).y - geom(b).y)
  const columns = rowCellTexts(rows[0])
  const body = rows.slice(1)
  const sample = body.length > 0 ? body[0] : rows[0]
  const cells = rowCellShape(sample, ctx)
  return {
    role: 'table',
    box: boxOf(node, ctx),
    columns: columns.length > 0 ? columns : undefined,
    cells: cells.length > 0 ? cells : undefined,
    rows: body.length
  }
}

// A row's content-bearing cells, left to right.
function rowCells(row: SceneNode): Array<SceneNode> {
  return childrenOf(row)
    .filter((cell) => isVisible(cell) && hasContent(cell))
    .sort((a, b) => geom(a).x - geom(b).x)
}

function rowCellTexts(row: SceneNode): Array<string> {
  return rowCells(row)
    .map((cell) => cleanText(collectVisibleText(cell)))
    .filter((text) => text.length > 0)
}

function rowCellShape(row: SceneNode, ctx: Ctx): Array<string> {
  return rowCells(row).map((cell) => cellKind(cell, ctx))
}

// What a table cell renders, for the row-shape summary.
function cellKind(cell: SceneNode, ctx: Ctx): string {
  if (cell.type === 'INSTANCE') {
    const name = ctx.instanceNames.get(cell.id) ?? cleanText(cell.name)
    return name.length > 0 ? name : 'icon'
  }
  const text = cleanText(collectVisibleText(cell))
  if (text.length === 0) {
    return 'icon'
  }
  if (/^[\d.,$%+-]+$/.test(text.replace(/\s/g, ''))) {
    return 'number'
  }
  if (hasPill(cell)) {
    return hasIconDescendant(cell) ? 'status' : 'badge'
  }
  return 'text'
}

function cellCount(node: SceneNode): number {
  return childrenOf(node).filter((cell) => isVisible(cell) && hasContent(cell))
    .length
}

function verticallyStacked(rows: ReadonlyArray<SceneNode>): boolean {
  const sorted = [...rows].sort((a, b) => geom(a).y - geom(b).y)
  for (let i = 1; i < sorted.length; i++) {
    const prev = geom(sorted[i - 1])
    const cur = geom(sorted[i])
    if (cur.y < prev.y + prev.h * 0.5) {
      return false
    }
  }
  return true
}

function median(values: Array<number>): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function horizontallyArranged(items: ReadonlyArray<SceneNode>): boolean {
  const sorted = [...items].sort((a, b) => geom(a).x - geom(b).x)
  for (let i = 1; i < sorted.length; i++) {
    const prev = geom(sorted[i - 1])
    const cur = geom(sorted[i])
    if (cur.x < prev.x + prev.w * 0.5) {
      return false
    }
  }
  return true
}

// --- table cell pills (badge/status) ---------------------------------------

// A rounded, painted chip anywhere inside the node — a badge/status pill, even
// when nested in a table-cell wrapper that has no fill of its own.
function hasPill(node: SceneNode): boolean {
  const walk = (current: SceneNode, depth: number): boolean => {
    if (depth > 3) {
      return false
    }
    for (const child of childrenOf(current)) {
      if (!isVisible(child)) {
        continue
      }
      if ((isRounded(child) || child.type === 'ELLIPSE') && hasVisiblePaint(child)) {
        return true
      }
      if (walk(child, depth + 1)) {
        return true
      }
    }
    return false
  }
  return walk(node, 0)
}

function hasIconDescendant(node: SceneNode): boolean {
  const walk = (current: SceneNode, depth: number): boolean => {
    if (depth > 3) {
      return false
    }
    for (const child of childrenOf(current)) {
      if (!isVisible(child)) {
        continue
      }
      if (child.type === 'INSTANCE' || isIconShape(child)) {
        return true
      }
      if (walk(child, depth + 1)) {
        return true
      }
    }
    return false
  }
  return walk(node, 0)
}

// --- icon + label pairing --------------------------------------------------

// Fold a standalone icon into the label it sits beside (e.g. a sidebar nav row's
// icon + text) so the pair reads as one item carrying `icons`, instead of two.
function mergeIconLabels(elements: Array<Element>): Array<Element> {
  const removed = new Set<Element>()
  for (const icon of elements) {
    if (removed.has(icon) || !isIconElement(icon)) {
      continue
    }
    const target = nearestLabel(icon, elements, removed)
    if (target === null) {
      continue
    }
    const name = icon.component ?? icon.text ?? 'icon'
    target.icons = [...(target.icons ?? []), name]
    removed.add(icon)
  }
  return elements.filter((element) => !removed.has(element))
}

function isIconElement(element: Element): boolean {
  if (element.box === undefined || element.text !== undefined) {
    return false
  }
  if (element.role !== 'icon' && element.role !== 'component') {
    return false
  }
  return Math.max(element.box.w, element.box.h) < 32
}

// Nearest text-role label in the same row, horizontally adjacent to the icon.
function nearestLabel(
  icon: Element,
  elements: Array<Element>,
  removed: Set<Element>
): Element | null {
  const ib = icon.box
  if (ib === undefined) {
    return null
  }
  const iconCy = ib.y + ib.h / 2
  let best: Element | null = null
  let bestGap = Infinity
  for (const element of elements) {
    if (element === icon || removed.has(element) || element.box === undefined) {
      continue
    }
    if (element.text === undefined || TEXT_ROLES.indexOf(element.role) === -1) {
      continue
    }
    const b = element.box
    if (iconCy < b.y || iconCy > b.y + b.h) {
      continue
    }
    const gap = ib.x >= b.x + b.w ? ib.x - (b.x + b.w) : b.x - (ib.x + ib.w)
    if (gap >= 0 && gap <= b.h && gap < bestGap) {
      bestGap = gap
      best = element
    }
  }
  return best
}

// --- repeating cards -------------------------------------------------------

// A horizontal row of ≥3 similar, multi-text cards (e.g. KPI/stat cards) collapses
// to one summary (count + the shape of one card); the demo values live in the
// screenshot. Distinct from a toolbar/tab row, whose items carry ≤1 text.
function isCardRow(node: SceneNode): boolean {
  if (!('children' in node)) {
    return false
  }
  const cards = childrenOf(node).filter(isVisible)
  if (cards.length < 3) {
    return false
  }
  const widths = cards.map((card) => geom(card).w)
  const med = median(widths)
  if (med <= 0) {
    return false
  }
  const uniform = widths.every((w) => Math.abs(w - med) <= med * 0.4)
  const rich = cards.every(
    (card) => !isIconSized(card) && collectTexts(card).length >= 2
  )
  return uniform && rich && horizontallyArranged(cards)
}

function cardRowElement(node: SceneNode, ctx: Ctx): Element {
  const cards = childrenOf(node)
    .filter(isVisible)
    .sort((a, b) => geom(a).x - geom(b).x)
  const cells = cardShape(cards[0], ctx)
  return {
    role: 'cards',
    box: boxOf(node, ctx),
    cells: cells.length > 0 ? cells : undefined,
    count: cards.length
  }
}

// The content of one card, in reading order, as number/icon/text tokens.
function cardShape(card: SceneNode, ctx: Ctx): Array<string> {
  const parts: Array<string> = []
  const walk = (current: SceneNode, depth: number): void => {
    if (depth > 4 || parts.length >= 12) {
      return
    }
    for (const child of childrenOf(current)) {
      if (!isVisible(child)) {
        continue
      }
      if (child.type === 'INSTANCE') {
        const name = ctx.instanceNames.get(child.id) ?? cleanText(child.name)
        parts.push(name.length > 0 ? name : 'icon')
        continue
      }
      if (child.type === 'TEXT') {
        const text = cleanText(child.characters)
        if (text.length > 0) {
          parts.push(isNumeric(text) ? 'number' : 'text')
        }
        continue
      }
      if (isIconShape(child)) {
        parts.push('icon')
        continue
      }
      walk(child, depth + 1)
    }
  }
  walk(card, 0)
  return parts
}

function isNumeric(text: string): boolean {
  return /^[\d.,$%+-]+$/.test(text.replace(/\s/g, ''))
}

// --- tab / segmented control -----------------------------------------------

// A horizontal, filled container of ≥2 short-text items — a tab/segmented
// control. Collapsed to one element; the labels are preserved in `text`.
function isTabRow(node: SceneNode): boolean {
  if (!('children' in node) || !hasVisibleFill(node)) {
    return false
  }
  const items = childrenOf(node).filter(isVisible)
  if (items.length < 2) {
    return false
  }
  const heights = items.map((item) => geom(item).h)
  const med = median(heights)
  if (med <= 0 || med > 48) {
    return false
  }
  const uniform = heights.every((h) => Math.abs(h - med) <= med * 0.5)
  const shortText = items.every((item) => {
    const texts = collectTexts(item)
    return texts.length >= 1 && texts.every(isShort)
  })
  return uniform && shortText && horizontallyArranged(items)
}

function tabsElement(node: SceneNode, ctx: Ctx): Element {
  const labels = childrenOf(node)
    .filter(isVisible)
    .sort((a, b) => geom(a).x - geom(b).x)
    .map((item) => cleanText(collectVisibleText(item)))
    .filter((text) => text.length > 0)
  return {
    role: 'tabs',
    box: boxOf(node, ctx),
    text: labels.length > 0 ? labels.join(' ') : undefined
  }
}

// The one place we consult layer names: drop obvious mock chrome (a mouse
// cursor, scrollbar) that isn't part of the real UI being described.
function isDecorative(node: SceneNode): boolean {
  return /\b(cursor|pointer|mouse|scrollbar|caret)\b/i.test(node.name)
}

// Remove tiny text labels that sit on top of a chart/image — axis ticks, legend
// text, tooltips. They belong to the visual, not the composition.
function dropChartLabels(elements: Array<Element>): Array<Element> {
  const visuals = elements.filter(
    (element) =>
      element.box !== undefined &&
      (element.role === 'image' ||
        element.role === 'chart' ||
        element.role === 'progress')
  )
  if (visuals.length === 0) {
    return elements
  }
  return elements.filter((element) => {
    if (element.box === undefined || TEXT_ROLES.indexOf(element.role) === -1) {
      return true
    }
    const words = (element.text ?? '').trim().split(/\s+/).length
    const tiny = words <= 3 && element.box.h <= 28
    if (!tiny) {
      return true
    }
    return !visuals.some(
      (visual) => coverage(element.box!, visual.box!) > 0.6
    )
  })
}

// Drop a visual (chart/image/progress) that sits almost entirely inside a LARGER
// visual — a double-count from nested plot frames, or a floating overlay frozen
// over a chart (e.g. a hover tooltip captured as a second chart). Keep the
// bigger one; the smaller is noise.
function dropNestedVisuals(elements: Array<Element>): Array<Element> {
  const isVisual = (element: Element): boolean =>
    element.box !== undefined &&
    (element.role === 'chart' ||
      element.role === 'image' ||
      element.role === 'progress')
  const drop = new Set<Element>()
  for (const small of elements) {
    if (!isVisual(small)) {
      continue
    }
    for (const big of elements) {
      if (
        big !== small &&
        isVisual(big) &&
        area(big.box!) > area(small.box!) &&
        coverage(small.box!, big.box!) > 0.6
      ) {
        drop.add(small)
        break
      }
    }
  }
  return elements.filter((element) => !drop.has(element))
}

function area(box: Box): number {
  return box.w * box.h
}

// Fraction of `inner` that lies within `outer`.
function coverage(inner: Box, outer: Box): number {
  const ix = Math.max(
    0,
    Math.min(inner.x + inner.w, outer.x + outer.w) - Math.max(inner.x, outer.x)
  )
  const iy = Math.max(
    0,
    Math.min(inner.y + inner.h, outer.y + outer.h) - Math.max(inner.y, outer.y)
  )
  const innerArea = inner.w * inner.h
  return innerArea > 0 ? (ix * iy) / innerArea : 0
}

// --- role inference --------------------------------------------------------

function inferTextRole(node: TextNode, ctx: Ctx): Role {
  // A bound named text style (e.g. "Desktop/Body", "Heading/sm") is a stronger,
  // device-independent signal than raw size — trust it when present and mappable.
  if (typeof node.textStyleId === 'string' && node.textStyleId.length > 0) {
    const styled = ctx.textStyleRoles.get(node.textStyleId)
    if (styled !== undefined) {
      return styled
    }
  }
  const size = textSize(node)
  const bold = isBold(node)
  const upper = node.textCase === 'UPPER' || isAllCaps(node.characters)
  const words = node.characters.trim().split(/\s+/).length

  if (upper && size <= 16 && words <= 6) {
    return 'eyebrow'
  }
  if (ctx.maxTextSize > 0 && size >= ctx.maxTextSize * 0.95) {
    return 'heading'
  }
  if (bold && ctx.maxTextSize > 0 && size >= ctx.maxTextSize * 0.6) {
    return 'subheading'
  }
  if (size <= 12) {
    return 'caption'
  }
  return 'body'
}

function isButton(node: SceneNode, ctx: Ctx): boolean {
  if (!('children' in node)) {
    return false
  }
  const texts = collectTexts(node)
  if (texts.length !== 1 || !isShort(texts[0])) {
    return false
  }
  // A heading-sized label is a title, not a button — keep a single short heading
  // in a filled frame (e.g. a card title) from being read as a button.
  if (inferTextRole(texts[0], ctx) === 'heading') {
    return false
  }
  return hasButtonFill(node) && isRounded(node)
}

function isFilledButtonRect(node: SceneNode): boolean {
  if (node.type !== 'RECTANGLE' && node.type !== 'ELLIPSE') {
    return false
  }
  return hasVisibleFill(node) && isRounded(node)
}

// A rounded, bordered box with no solid-button fill and at most a placeholder —
// a text input, not a button. (Buttons are solid-filled, or carry an icon+label.)
// Catches the form fields that otherwise read as buttons (placeholder text) or
// images (empty). The `input` role already exists; this is what finally emits it.
function isInput(node: SceneNode): boolean {
  if (node.type !== 'FRAME' && node.type !== 'COMPONENT') {
    return false
  }
  if (!isRounded(node) || !hasVisibleStroke(node) || isPrimary(node)) {
    return false
  }
  const texts = collectTexts(node)
  if (texts.length > 1 || (texts.length === 1 && !isShort(texts[0]))) {
    return false
  }
  return !childrenOf(node).some(
    (child) => isVisible(child) && (child.type === 'INSTANCE' || isIconShape(child))
  )
}

function inputElement(node: SceneNode, ctx: Ctx): Element {
  const placeholder = cleanText(collectVisibleText(node))
  return {
    role: 'input',
    text: placeholder.length > 0 ? placeholder : undefined,
    box: boxOf(node, ctx),
    rounded: true
  }
}

function hasVisibleStroke(node: SceneNode): boolean {
  if (!('strokes' in node)) {
    return false
  }
  return (node.strokes as ReadonlyArray<Paint>).some(
    (paint) => paint.visible !== false && (paint.opacity ?? 1) > 0
  )
}

// A small, circular element carrying initials (letters) or an image fill — a
// user avatar, not a button. The letters-not-digits gate keeps circular count
// badges (e.g. "3") classified as badges.
function isAvatar(node: SceneNode): boolean {
  if (node.type !== 'FRAME' && node.type !== 'COMPONENT') {
    return false
  }
  const g = geom(node)
  if (g.w <= 0 || g.h <= 0) {
    return false
  }
  const aspect = g.w / g.h
  if (aspect < 0.7 || aspect > 1.4 || Math.max(g.w, g.h) > 96) {
    return false
  }
  const circular = (n: SceneNode): boolean => {
    const ng = geom(n)
    return n.type === 'ELLIPSE' || maxCornerRadius(n) >= Math.min(ng.w, ng.h) * 0.4
  }
  if (
    !circular(node) &&
    !childrenOf(node).some((child) => isVisible(child) && circular(child))
  ) {
    return false
  }
  const texts = collectTexts(node)
  const initials =
    texts.length === 1 &&
    texts[0].characters.trim().length <= 3 &&
    /[A-Za-z]/.test(texts[0].characters)
  return initials || hasImageFill(node)
}

function avatarElement(node: SceneNode, ctx: Ctx): Element {
  const texts = collectTexts(node)
  const initials = texts.length === 1 ? cleanText(texts[0].characters) : ''
  return {
    role: 'avatar',
    box: boxOf(node, ctx),
    text: initials.length > 0 ? initials : undefined,
    rounded: true,
    color: colorOf(node, ctx)
  }
}

function hasImageFill(node: SceneNode): boolean {
  const imageInFills = (n: SceneNode): boolean => {
    if (!('fills' in n) || n.fills === figma.mixed) {
      return false
    }
    return (n.fills as ReadonlyArray<Paint>).some(
      (paint) => paint.type === 'IMAGE' && paint.visible !== false
    )
  }
  if (imageInFills(node)) {
    return true
  }
  return childrenOf(node).some((child) => isVisible(child) && imageInFills(child))
}

function isPrimary(node: SceneNode): boolean {
  const fill = firstSolidFill(node)
  if (fill === null) {
    return false
  }
  const { r, g, b } = fill.color
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.5
}

function isProgress(box: Box, ctx: Ctx): boolean {
  return (
    box.h > 0 &&
    box.w / box.h > 6 &&
    box.h < 24 &&
    ctx.frameHeight > 0 &&
    box.y - 0 < ctx.frameHeight * 0.15
  )
}

// --- auto-layout -----------------------------------------------------------

interface AutoLayout {
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
  itemSpacing: number
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
  primaryAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN'
  counterAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE'
  layoutWrap?: 'NO_WRAP' | 'WRAP'
}

// Layout descriptor for a structural auto-layout frame worth surfacing as a group
// box: explicit auto-layout, ≥2 children, not the whole frame, shallow enough to
// stay legible. Returns undefined when it shouldn't become a group.
function groupLayout(
  node: SceneNode,
  ctx: Ctx,
  depth: number
): Element['layout'] | undefined {
  if (depth > 3 || !('layoutMode' in node)) {
    return undefined
  }
  const al = node as unknown as AutoLayout
  if (al.layoutMode !== 'HORIZONTAL' && al.layoutMode !== 'VERTICAL') {
    return undefined
  }
  if (childrenOf(node).filter(isVisible).length < 2) {
    return undefined
  }
  const box = boxOf(node, ctx)
  if (box.w >= ctx.frameWidth * 0.95 && box.h >= ctx.frameHeight * 0.95) {
    return undefined
  }
  return layoutIntent(node)
}

function layoutIntent(node: SceneNode): Element['layout'] | undefined {
  if (!('layoutMode' in node)) {
    return undefined
  }
  const al = node as unknown as AutoLayout
  if (al.layoutMode !== 'HORIZONTAL' && al.layoutMode !== 'VERTICAL') {
    return undefined
  }
  const justify = PRIMARY_ALIGN[al.primaryAxisAlignItems]
  const layout: Element['layout'] = {
    dir: al.layoutMode === 'HORIZONTAL' ? 'row' : 'col'
  }
  // Spacing is "auto" under space-between, so only report a gap otherwise.
  if (justify !== 'between' && typeof al.itemSpacing === 'number' && al.itemSpacing > 0) {
    layout.gap = Math.round(al.itemSpacing)
  }
  if (justify !== undefined) {
    layout.justify = justify
  }
  const align = COUNTER_ALIGN[al.counterAxisAlignItems]
  if (align !== undefined) {
    layout.align = align
  }
  if (al.layoutWrap === 'WRAP') {
    layout.wrap = true
  }
  return layout
}

function paddingOf(node: SceneNode): Element['padding'] | undefined {
  if (!('layoutMode' in node)) {
    return undefined
  }
  const al = node as unknown as AutoLayout
  if (al.layoutMode !== 'HORIZONTAL' && al.layoutMode !== 'VERTICAL') {
    return undefined
  }
  const top = Math.round(al.paddingTop)
  const right = Math.round(al.paddingRight)
  const bottom = Math.round(al.paddingBottom)
  const left = Math.round(al.paddingLeft)
  if (top === 0 && right === 0 && bottom === 0 && left === 0) {
    return undefined
  }
  if (top === right && right === bottom && bottom === left) {
    return top
  }
  if (top === bottom && right === left) {
    return [top, right]
  }
  return [top, right, bottom, left]
}

function overflowOf(node: SceneNode): Element['overflow'] | undefined {
  return 'clipsContent' in node && node.clipsContent ? 'clip' : undefined
}

// 'start' is the default and left implicit to keep the legend terse.
const PRIMARY_ALIGN: { [key: string]: string | undefined } = {
  MIN: undefined,
  MAX: 'end',
  CENTER: 'center',
  SPACE_BETWEEN: 'between'
}
const COUNTER_ALIGN: { [key: string]: string | undefined } = {
  MIN: undefined,
  MAX: 'end',
  CENTER: 'center',
  BASELINE: 'baseline'
}

// --- property helpers ------------------------------------------------------

function textSize(node: TextNode): number {
  if (node.fontSize === figma.mixed) {
    try {
      return node.getRangeFontSize(0, 1) as number
    } catch {
      return 0
    }
  }
  return node.fontSize
}

function isBold(node: TextNode): boolean {
  let font = node.fontName
  if (font === figma.mixed) {
    try {
      font = node.getRangeFontName(0, 1)
    } catch {
      return false
    }
  }
  return /bold|semibold|black|heavy|medium/.test((font as FontName).style.toLowerCase())
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, '')
  return letters.length > 0 && letters === letters.toUpperCase()
}

function isShort(node: TextNode): boolean {
  return node.characters.trim().split(/\s+/).length <= 5
}

function maxCornerRadius(node: SceneNode): number {
  if ('cornerRadius' in node && node.cornerRadius !== figma.mixed) {
    return node.cornerRadius as number
  }
  if ('topLeftRadius' in node) {
    const corners = node as RectangleCornerMixin
    return Math.max(
      corners.topLeftRadius,
      corners.topRightRadius,
      corners.bottomLeftRadius,
      corners.bottomRightRadius
    )
  }
  return 0
}

function isRounded(node: SceneNode): boolean {
  return maxCornerRadius(node) >= 6
}

// Rounded if the node (or its background child) has a corner radius, or it's an
// ellipse. Used to render rounded vs sharp corners in the wireframe.
function isRoundedShape(node: SceneNode): boolean {
  if (node.type === 'ELLIPSE') {
    return true
  }
  if (isRounded(node)) {
    return true
  }
  for (const child of childrenOf(node)) {
    if (isRounded(child)) {
      return true
    }
  }
  return false
}

function firstSolidFill(node: SceneNode): SolidPaint | null {
  if (!('fills' in node) || node.fills === figma.mixed) {
    return null
  }
  for (const paint of node.fills) {
    if (paint.type === 'SOLID' && paint.visible !== false && (paint.opacity ?? 1) > 0) {
      return paint
    }
  }
  return null
}

// --- color extraction ------------------------------------------------------

// The element's fill/text color when extraction is on: a design-token name
// (bound variable, then bound color style) in 'tokens' mode, else a raw hex.
// 'hex' mode is always hex; 'off' yields nothing.
function colorOf(node: SceneNode, ctx: Ctx): string | undefined {
  if (ctx.colorMode === 'off') {
    return undefined
  }
  const source = colorSource(node)
  if (source === null) {
    return undefined
  }
  const { paint, owner } = source
  if (ctx.colorMode === 'tokens') {
    const alias = paint.boundVariables?.color
    if (alias !== undefined) {
      const name = ctx.variableNames.get(alias.id)
      if (name !== undefined) {
        return name
      }
    }
    if (
      'fillStyleId' in owner &&
      typeof owner.fillStyleId === 'string' &&
      owner.fillStyleId.length > 0
    ) {
      const styleName = ctx.colorStyleNames.get(owner.fillStyleId)
      if (styleName !== undefined) {
        return styleName
      }
    }
  }
  return rgbToHex(paint.color)
}

// The fill that represents an element's color: the node's own solid fill, or a
// near-full-cover filled child (an avatar's circle, a button's background rect)
// when the node itself is unfilled. The owner carries the variable/style binding.
function colorSource(
  node: SceneNode
): { paint: SolidPaint; owner: SceneNode } | null {
  const own = firstSolidFill(node)
  if (own !== null) {
    return { paint: own, owner: node }
  }
  const g = geom(node)
  if (g.w <= 0 || g.h <= 0) {
    return null
  }
  for (const child of childrenOf(node)) {
    if (!isVisible(child)) {
      continue
    }
    const c = geom(child)
    if (c.w >= g.w * 0.9 && c.h >= g.h * 0.9) {
      const fill = firstSolidFill(child)
      if (fill !== null) {
        return { paint: fill, owner: child }
      }
    }
  }
  return null
}

function rgbToHex(color: RGB): string {
  const channel = (value: number): string =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, '0')
  return '#' + channel(color.r) + channel(color.g) + channel(color.b)
}

// Resolve every fill-bound variable / color style under the frame to its token
// name, up front. Only needed in 'tokens' mode ('hex' always emits hex; 'off'
// emits nothing).
async function resolveColorTokens(
  root: SceneNode,
  mode: ColorMode
): Promise<{
  variableNames: Map<string, string>
  colorStyleNames: Map<string, string>
}> {
  const variableNames = new Map<string, string>()
  const colorStyleNames = new Map<string, string>()
  if (mode !== 'tokens') {
    return { variableNames, colorStyleNames }
  }
  const variableIds = new Set<string>()
  const styleIds = new Set<string>()
  const walk = (node: SceneNode, depth: number): void => {
    if (!isVisible(node) || depth > 12) {
      return
    }
    if ('fills' in node && node.fills !== figma.mixed) {
      for (const paint of node.fills) {
        if (paint.type === 'SOLID') {
          const alias = paint.boundVariables?.color
          if (alias !== undefined) {
            variableIds.add(alias.id)
          }
        }
      }
    }
    if (
      'fillStyleId' in node &&
      typeof node.fillStyleId === 'string' &&
      node.fillStyleId.length > 0
    ) {
      styleIds.add(node.fillStyleId)
    }
    for (const child of childrenOf(node)) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)

  for (const id of variableIds) {
    try {
      const variable = await figma.variables.getVariableByIdAsync(id)
      if (variable !== null) {
        variableNames.set(id, cleanText(variable.name))
      }
    } catch {
      // Unresolvable variable — colorOf falls back to hex.
    }
  }
  for (const id of styleIds) {
    try {
      const style = await figma.getStyleByIdAsync(id)
      if (style !== null) {
        colorStyleNames.set(id, cleanText(style.name))
      }
    } catch {
      // Unresolvable style.
    }
  }
  return { variableNames, colorStyleNames }
}

// Drop the default text color — the primary text tone (what headings use, else
// the most common) — from text elements that share it. That's the color an LLM
// assumes; only the deviations (muted, accent) carry signal. Fills/components
// keep their colors.
function dropDefaultTextColor(elements: Array<Element>): Array<Element> {
  const textColors = elements.filter(
    (element) =>
      element.color !== undefined && TEXT_ROLES.indexOf(element.role) !== -1
  )
  if (textColors.length === 0) {
    return elements
  }
  const heading = textColors.find(
    (element) => element.role === 'heading' || element.role === 'subheading'
  )
  let defaultColor = heading?.color
  if (defaultColor === undefined) {
    const counts = new Map<string, number>()
    for (const element of textColors) {
      counts.set(element.color!, (counts.get(element.color!) ?? 0) + 1)
    }
    let max = 0
    for (const [color, n] of counts) {
      if (n > max) {
        max = n
        defaultColor = color
      }
    }
  }
  if (defaultColor === undefined) {
    return elements
  }
  return elements.map((element) =>
    TEXT_ROLES.indexOf(element.role) !== -1 && element.color === defaultColor
      ? { ...element, color: undefined }
      : element
  )
}

function hasVisibleFill(node: SceneNode): boolean {
  return firstSolidFill(node) !== null
}

// Button background fill lives on the node itself or a child that (nearly) fills
// it — a real button is a filled container. A small filled child (an icon, a
// chart legend swatch, a partial decal) must NOT make its parent a button: that
// false positive was tagging chart titles and legend chips as buttons.
function hasButtonFill(node: SceneNode): boolean {
  if (hasVisibleFill(node)) {
    return true
  }
  const g = geom(node)
  for (const child of childrenOf(node)) {
    if (!hasVisibleFill(child)) {
      continue
    }
    const c = geom(child)
    if (c.w >= g.w * 0.9 && c.h >= g.h * 0.9) {
      return true
    }
  }
  return false
}

// Any visible paint — a solid/gradient/image fill or a stroke. Broader than
// hasVisibleFill (which is solid-only, for button detection): this answers "is
// this shape drawn at all", so an unpainted spacer frame isn't mistaken for an
// image.
function hasVisiblePaint(node: SceneNode): boolean {
  const visible = (paint: Paint): boolean =>
    paint.visible !== false && (paint.opacity ?? 1) > 0
  if ('fills' in node && node.fills !== figma.mixed) {
    if ((node.fills as ReadonlyArray<Paint>).some(visible)) {
      return true
    }
  }
  if ('strokes' in node && (node.strokes as ReadonlyArray<Paint>).some(visible)) {
    return true
  }
  return false
}

// --- traversal helpers -----------------------------------------------------

function isVisible(node: SceneNode): boolean {
  if (node.visible === false) {
    return false
  }
  return !('opacity' in node) || node.opacity > 0
}

function childrenOf(node: SceneNode): ReadonlyArray<SceneNode> {
  return 'children' in node ? node.children : []
}

function geom(node: SceneNode): { x: number; y: number; w: number; h: number } {
  const layout = node as unknown as LayoutMixin
  return { x: layout.x, y: layout.y, w: layout.width, h: layout.height }
}

function boxOf(node: SceneNode, ctx: Ctx): Box {
  if ('absoluteBoundingBox' in node && node.absoluteBoundingBox !== null) {
    const b = node.absoluteBoundingBox
    return { x: b.x - ctx.originX, y: b.y - ctx.originY, w: b.width, h: b.height }
  }
  const g = geom(node)
  return { x: g.x, y: g.y, w: g.w, h: g.h }
}

function unionBox(boxes: Array<Box>): Box | null {
  if (boxes.length === 0) {
    return null
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of boxes) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.w)
    maxY = Math.max(maxY, box.y + box.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function centerInside(inner: SceneNode, outer: SceneNode): boolean {
  const a = (inner as unknown as LayoutMixin)
  const b = (outer as unknown as LayoutMixin)
  const cx = a.x + a.width / 2
  const cy = a.y + a.height / 2
  return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height
}

function cleanText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > 300 ? collapsed.slice(0, 299) + '…' : collapsed
}

// Text with semibold-or-heavier runs wrapped in Markdown **emphasis**, so an
// inline @-mention/entity ("…in **App** for…") survives instead of flattening to
// plain prose. Only marks when the node MIXES weights — a uniformly bold heading
// stays plain (its role already conveys weight).
function styledText(node: TextNode): string {
  let segments: Array<{ characters: string; fontName: FontName | symbol }>
  try {
    segments = node.getStyledTextSegments(['fontName'])
  } catch {
    return cleanText(node.characters)
  }
  if (segments.length <= 1) {
    return cleanText(node.characters)
  }
  const heavy = (segment: { fontName: FontName | symbol }): boolean => {
    const font = segment.fontName
    return (
      typeof font !== 'symbol' &&
      /bold|semibold|black|heavy/.test(font.style.toLowerCase())
    )
  }
  const anyHeavy = segments.some((s) => heavy(s) && s.characters.trim().length > 0)
  const anyPlain = segments.some((s) => !heavy(s) && s.characters.trim().length > 0)
  if (!anyHeavy || !anyPlain) {
    return cleanText(node.characters)
  }
  let raw = ''
  for (const segment of segments) {
    if (heavy(segment) && segment.characters.trim().length > 0) {
      const lead = (segment.characters.match(/^\s*/) ?? [''])[0]
      const trail = (segment.characters.match(/\s*$/) ?? [''])[0]
      raw += lead + '**' + segment.characters.trim() + '**' + trail
    } else {
      raw += segment.characters
    }
  }
  return cleanText(raw)
}

function collectTexts(node: SceneNode): Array<TextNode> {
  const out: Array<TextNode> = []
  const walk = (current: SceneNode): void => {
    if (!isVisible(current)) {
      return
    }
    if (current.type === 'TEXT') {
      out.push(current)
      return
    }
    if (current.type === 'INSTANCE') {
      return
    }
    for (const child of childrenOf(current)) {
      walk(child)
    }
  }
  walk(node)
  return out
}

function collectVisibleText(node: SceneNode): string {
  const parts: Array<string> = []
  const walk = (current: SceneNode): void => {
    if (!isVisible(current)) {
      return
    }
    if (current.type === 'TEXT') {
      parts.push(current.characters)
      return
    }
    for (const child of childrenOf(current)) {
      walk(child)
    }
  }
  walk(node)
  return parts.join(' ')
}

function hasContent(node: SceneNode): boolean {
  if (!isVisible(node)) {
    return false
  }
  if (node.type === 'INSTANCE') {
    return true
  }
  if (node.type === 'TEXT') {
    return cleanText(node.characters).length > 0
  }
  for (const child of childrenOf(node)) {
    if (hasContent(child)) {
      return true
    }
  }
  return false
}

function sortByX(nodes: ReadonlyArray<SceneNode>): Array<SceneNode> {
  return [...nodes].sort((a, b) => geom(a).x - geom(b).x)
}

function groupRows(nodes: ReadonlyArray<SceneNode>): Array<Array<SceneNode>> {
  const sorted = [...nodes].sort((a, b) => {
    const ga = geom(a)
    const gb = geom(b)
    return ga.y - gb.y || ga.x - gb.x
  })
  const rows: Array<Array<SceneNode>> = []
  let current: Array<SceneNode> = []
  let rowBottom = -Infinity
  for (const node of sorted) {
    const { y, h } = geom(node)
    if (current.length > 0 && y < rowBottom - 2) {
      current.push(node)
      rowBottom = Math.max(rowBottom, y + h)
    } else {
      current = [node]
      rows.push(current)
      rowBottom = y + h
    }
  }
  return rows.map((row) => row.sort((a, b) => geom(a).x - geom(b).x))
}

async function resolveInstanceNames(root: SceneNode): Promise<Map<string, string>> {
  const instances = new Map<string, InstanceNode>()
  const collectIconInstances = (node: SceneNode, depth: number): void => {
    if (depth > 4) {
      return
    }
    for (const child of childrenOf(node)) {
      if (!isVisible(child)) {
        continue
      }
      if (child.type === 'INSTANCE') {
        if (isIconSized(child)) {
          instances.set(child.id, child)
        }
        continue
      }
      collectIconInstances(child, depth + 1)
    }
  }
  const walk = (node: SceneNode, depth: number): void => {
    if (!isVisible(node) || depth > 8) {
      return
    }
    if (node.type === 'INSTANCE') {
      instances.set(node.id, node)
      // The emitted component is a boundary. Only icon-sized nested instances
      // need names for the compact icons summary.
      collectIconInstances(node, 0)
      return
    }
    for (const child of childrenOf(node)) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)

  const resolved = await Promise.all(Array.from(instances.values()).map(async (instance) => {
    const main = await instance.getMainComponentAsync()
    let name = main === null ? instance.name : main.name
    if (main !== null && main.parent !== null && main.parent.type === 'COMPONENT_SET') {
      name = main.parent.name
    }
    return [instance.id, cleanText(name)] as const
  }))
  return new Map(resolved)
}

// Resolve every bound text-style id under the frame to a role (once, up front).
// "Desktop/Body" → body, "Heading/sm" → heading, etc. Unmapped styles are
// omitted so inferTextRole falls back to its size heuristic.
async function resolveTextStyleRoles(root: SceneNode): Promise<Map<string, Role>> {
  const ids = new Set<string>()
  const walk = (node: SceneNode, depth: number): void => {
    if (!isVisible(node) || depth > 12) {
      return
    }
    if (node.type === 'TEXT') {
      if (typeof node.textStyleId === 'string' && node.textStyleId.length > 0) {
        ids.add(node.textStyleId)
      }
      return
    }
    for (const child of childrenOf(node)) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)

  const map = new Map<string, Role>()
  for (const id of ids) {
    try {
      const style = await figma.getStyleByIdAsync(id)
      if (style !== null) {
        const role = roleFromStyleName(style.name)
        if (role !== null) {
          map.set(id, role)
        }
      }
    } catch {
      // Ignore unresolvable styles; the size heuristic still applies.
    }
  }
  return map
}

// Map a named text style to a role by keyword. Order matters: check the more
// specific names (eyebrow, subhead) before the substrings they contain.
function roleFromStyleName(name: string): Role | null {
  const lower = name.toLowerCase()
  if (/eyebrow|overline|kicker/.test(lower)) {
    return 'eyebrow'
  }
  if (/caption|footnote|legal|micro/.test(lower)) {
    return 'caption'
  }
  if (/subhead|subtitle/.test(lower)) {
    return 'subheading'
  }
  if (/headline|heading|title|display/.test(lower)) {
    return 'heading'
  }
  if (/body|paragraph|\btext\b|copy/.test(lower)) {
    return 'body'
  }
  return null
}

function collectMaxTextSize(root: SceneNode): number {
  let max = 0
  const walk = (node: SceneNode): void => {
    if (!isVisible(node)) {
      return
    }
    if (node.type === 'TEXT') {
      max = Math.max(max, textSize(node))
      return
    }
    if (node.type === 'INSTANCE') {
      return
    }
    for (const child of childrenOf(node)) {
      walk(child)
    }
  }
  walk(root)
  return max
}
