import { Box, Element, Role, ScreenData } from '../types'

// The guide is prose, so unlike the YAML below it, it is pre-wrapped: one
// unbroken 340-character blockquote scrolls off the side of any reader, the
// plugin's own file window included. Lines stay under 57 characters so that,
// with the '> ' marker, they fit without a horizontal scroll. Code spans are
// never split across a line.
const INTERPRETATION_GUIDE: ReadonlyArray<string> = [
  'AI interpretation: Implement these screens with the',
  "codebase's existing components and tokens. `box` is",
  '`[x, y, w, h]` in screen percentages; gaps and padding',
  'are Figma pixels; `children` defines ownership. Treat',
  'component entries as reusable boundaries, preserve',
  'text and props exactly, and use any supplied',
  'screenshot for visual details.'
]

const REFERENCE_GUIDE: ReadonlyArray<string> = [
  '`ref` points to a reusable component definition;',
  'boxes inside a definition are percentages of that',
  'component.'
]

function asBlockquote(lines: ReadonlyArray<string>): string {
  return lines
    .map(function (line) {
      return '> ' + line
    })
    .join('\n')
}

interface ElementTree {
  element: Element
  children: Array<ElementTree>
}

interface ReusableDefinition {
  id: string
  root: ElementTree
}

interface PreparedExport {
  forests: Array<Array<ElementTree>>
  definitions: Array<ReusableDefinition>
  definitionIdBySignature: Map<string, string>
  signatureByNode: Map<ElementTree, string>
}

// One block per screen: a YAML list of the screen's elements in reading order.
// Each item says WHAT it is (role / component name, variant props, exact text,
// composed icons, layout intent) and WHERE it sits — box: [x, y, w, h] as % of
// the frame. That pins a name onto a spot in the accompanying screenshot: the
// screenshot carries the picture, this list carries everything pixels can't show
// (component identity, variants, exact copy). Generic "Screen N" headings;
// frame/layer names are never emitted.
export function buildMarkdown(screens: Array<ScreenData>): string {
  const prepared = prepareExport(screens)
  const guide = asBlockquote(
    prepared.definitions.length > 0
      ? [...INTERPRETATION_GUIDE, ...REFERENCE_GUIDE]
      : INTERPRETATION_GUIDE
  )
  const blocks: Array<string> = []
  if (prepared.definitions.length > 0) {
    blocks.push(formatDefinitions(prepared))
  }
  for (let index = 0; index < screens.length; index++) {
    const elements = flattenForest(
      prepared.forests[index],
      prepared,
      undefined
    )
    blocks.push(formatScreen(screens[index], elements))
  }
  return guide + '\n\n' + blocks.join('\n\n') + '\n'
}

function formatScreen(screen: ScreenData, sourceElements: Array<Element>): string {
  // Number every placed element in reading order so an item has a stable ref.
  const assigned = assignIds(sourceElements)
  const elements = assigned.elements.filter(
    (element) => element.id !== undefined
  )
  const width = Math.round(screen.frameWidth)
  const height = Math.round(screen.frameHeight)
  const lines: Array<string> = [
    `## Screen ${screen.index} — ${width}×${height}`,
    '',
    '```yaml',
    '# box: [x, y, w, h] in % of frame',
    'screen:'
  ]
  if (screen.layout !== undefined) {
    lines.push(`  layout: ${yamlScalar(layoutString(screen.layout))}`)
  }
  if (screen.padding !== undefined) {
    lines.push(`  padding: ${paddingString(screen.padding)}`)
  }
  if (screen.overflow !== undefined) {
    lines.push(`  overflow: ${screen.overflow}`)
  }
  if (assigned.rootChildren.length > 0) {
    lines.push(`  children: [${assigned.rootChildren.join(', ')}]`)
  }
  lines.push('items:')
  for (const element of elements) {
    lines.push(itemLine(element, screen.frameWidth, screen.frameHeight))
  }
  lines.push('```')
  return lines.join('\n')
}

function prepareExport(screens: Array<ScreenData>): PreparedExport {
  const forests = screens.map((screen) => buildForest(screen.elements))
  const signatureByNode = new Map<ElementTree, string>()
  const representatives = new Map<string, ElementTree>()
  const counts = new Map<string, number>()
  const firstSeen: Array<string> = []

  const collect = (node: ElementTree): void => {
    if (
      node.element.expandedComponent === true &&
      node.element.box !== undefined &&
      node.children.length > 0
    ) {
      const signature = componentSignature(node)
      signatureByNode.set(node, signature)
      counts.set(signature, (counts.get(signature) ?? 0) + 1)
      if (!representatives.has(signature)) {
        representatives.set(signature, node)
        firstSeen.push(signature)
      }
    }
    for (const child of node.children) {
      collect(child)
    }
  }
  for (const forest of forests) {
    for (const root of forest) {
      collect(root)
    }
  }

  let selected = new Set(
    firstSeen.filter((signature) => (counts.get(signature) ?? 0) >= 2)
  )
  while (selected.size > 0) {
    const usages = effectiveDefinitionUsages(
      forests,
      selected,
      signatureByNode,
      representatives
    )
    const next = new Set(
      Array.from(selected).filter((signature) => (usages.get(signature) ?? 0) >= 2)
    )
    if (next.size === selected.size) {
      break
    }
    selected = next
  }

  const definitions: Array<ReusableDefinition> = []
  const definitionIdBySignature = new Map<string, string>()
  for (const signature of firstSeen) {
    if (!selected.has(signature)) {
      continue
    }
    const id = `C${definitions.length + 1}`
    definitionIdBySignature.set(signature, id)
    definitions.push({ id, root: representatives.get(signature)! })
  }
  return { forests, definitions, definitionIdBySignature, signatureByNode }
}

function buildForest(elements: Array<Element>): Array<ElementTree> {
  const nodes = elements.map((element) => ({ element, children: [] as Array<ElementTree> }))
  const bySourceId = new Map<string, ElementTree>()
  for (const node of nodes) {
    if (node.element.sourceNodeId !== undefined) {
      bySourceId.set(node.element.sourceNodeId, node)
    }
  }
  const roots: Array<ElementTree> = []
  for (const node of nodes) {
    const parent =
      node.element.parentSourceNodeId === undefined
        ? undefined
        : bySourceId.get(node.element.parentSourceNodeId)
    if (parent === undefined || parent === node) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }
  }
  return roots
}

function componentSignature(root: ElementTree): string {
  const rootBox = root.element.box!
  return JSON.stringify(canonicalTree(root, rootBox, true))
}

function canonicalTree(
  node: ElementTree,
  rootBox: Box,
  isRoot: boolean
): unknown {
  const element = node.element
  return [
    element.componentKey ?? null,
    element.componentSignature ?? null,
    element.role,
    element.component ?? null,
    sortedRecord(element.props),
    element.layout ?? null,
    element.padding ?? null,
    element.overflow ?? null,
    element.columns ?? null,
    element.cells ?? null,
    element.rows ?? null,
    element.count ?? null,
    element.text ?? null,
    element.color ?? null,
    element.icons ?? null,
    isRoot || element.box === undefined
      ? null
      : relativeBoxValues(element.box, rootBox),
    node.children.map((child) => canonicalTree(child, rootBox, false))
  ]
}

function sortedRecord(
  value: Element['props']
): Array<[string, string]> | null {
  if (value === undefined) {
    return null
  }
  return Object.keys(value)
    .sort()
    .map((key) => [key, value[key]])
}

function effectiveDefinitionUsages(
  forests: Array<Array<ElementTree>>,
  selected: Set<string>,
  signatureByNode: Map<ElementTree, string>,
  representatives: Map<string, ElementTree>
): Map<string, number> {
  const usages = new Map<string, number>()
  const queued = new Set<string>()
  const queue: Array<string> = []
  const visit = (node: ElementTree): void => {
    const signature = signatureByNode.get(node)
    if (signature !== undefined && selected.has(signature)) {
      usages.set(signature, (usages.get(signature) ?? 0) + 1)
      if (!queued.has(signature)) {
        queued.add(signature)
        queue.push(signature)
      }
      return
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  for (const forest of forests) {
    for (const root of forest) {
      visit(root)
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const representative = representatives.get(queue[index])
    if (representative === undefined) {
      continue
    }
    for (const child of representative.children) {
      visit(child)
    }
  }
  return usages
}

function flattenForest(
  forest: Array<ElementTree>,
  prepared: PreparedExport,
  localRoot: Box | undefined
): Array<Element> {
  const out: Array<Element> = []
  const visit = (node: ElementTree): void => {
    const signature = prepared.signatureByNode.get(node)
    const definitionId =
      signature === undefined
        ? undefined
        : prepared.definitionIdBySignature.get(signature)
    if (definitionId !== undefined) {
      out.push(referenceElement(node.element, definitionId, localRoot))
      return
    }
    out.push(rebaseElement(node.element, localRoot))
    for (const child of node.children) {
      visit(child)
    }
  }
  for (const root of forest) {
    visit(root)
  }
  return out
}

function referenceElement(
  element: Element,
  ref: string,
  localRoot: Box | undefined
): Element {
  return {
    role: 'component',
    ref,
    component: element.component,
    box: rebaseBox(element.box, localRoot),
    sourceNodeId: element.sourceNodeId,
    parentSourceNodeId: element.parentSourceNodeId
  }
}

function rebaseElement(element: Element, localRoot: Box | undefined): Element {
  return {
    ...element,
    box: rebaseBox(element.box, localRoot)
  }
}

function rebaseBox(box: Box | undefined, localRoot: Box | undefined): Box | undefined {
  if (box === undefined || localRoot === undefined) {
    return box
  }
  return { ...box, x: box.x - localRoot.x, y: box.y - localRoot.y }
}

function formatDefinitions(prepared: PreparedExport): string {
  const lines: Array<string> = [
    '## Reusable components',
    '',
    '```yaml',
    '# box: [x, y, w, h] in % of component',
    'components:'
  ]
  for (const definition of prepared.definitions) {
    const root = definition.root.element
    const rootBox = root.box!
    const elements = flattenForest(
      definition.root.children,
      prepared,
      rootBox
    )
    const assigned = assignIds(elements)
    lines.push(`  ${definition.id}:`)
    lines.push(`    component: ${yamlScalar(root.component ?? 'Component')}`)
    appendDefinitionProperties(lines, root)
    if (assigned.rootChildren.length > 0) {
      lines.push(`    children: [${assigned.rootChildren.join(', ')}]`)
    }
    lines.push('    items:')
    for (const element of assigned.elements) {
      if (element.id !== undefined) {
        lines.push(itemLine(element, rootBox.w, rootBox.h, '      '))
      }
    }
  }
  lines.push('```')
  return lines.join('\n')
}

function appendDefinitionProperties(lines: Array<string>, element: Element): void {
  if (element.props !== undefined) {
    const pairs = Object.keys(element.props).map(
      (key) => `${key}: ${yamlScalar(element.props![key])}`
    )
    if (pairs.length > 0) {
      lines.push(`    props: { ${pairs.join(', ')} }`)
    }
  }
  if (element.layout !== undefined) {
    lines.push(`    layout: ${yamlScalar(layoutString(element.layout))}`)
  }
  if (element.padding !== undefined) {
    lines.push(`    padding: ${paddingString(element.padding)}`)
  }
  if (element.overflow !== undefined) {
    lines.push(`    overflow: ${element.overflow}`)
  }
  if (element.color !== undefined) {
    lines.push(`    color: ${yamlScalar(element.color)}`)
  }
}

function assignIds(elements: Array<Element>): {
  elements: Array<Element>
  rootChildren: Array<number>
} {
  let next = 1
  const placed = elements.map((element) =>
    element.box !== undefined ? { ...element, id: next++ } : element
  )
  const idsBySource = new Map<string, number>()
  for (const element of placed) {
    if (element.sourceNodeId !== undefined && element.id !== undefined) {
      idsBySource.set(element.sourceNodeId, element.id)
    }
  }
  const childIds = new Map<string, Array<number>>()
  const rootChildren: Array<number> = []
  for (const element of placed) {
    if (element.id === undefined) {
      continue
    }
    const parentId =
      element.parentSourceNodeId === undefined
        ? undefined
        : idsBySource.get(element.parentSourceNodeId)
    if (parentId === undefined) {
      rootChildren.push(element.id)
      continue
    }
    const children = childIds.get(element.parentSourceNodeId!) ?? []
    children.push(element.id)
    childIds.set(element.parentSourceNodeId!, children)
  }
  return {
    elements: placed.map((element) => {
      const {
        sourceNodeId,
        parentSourceNodeId,
        componentKey,
        componentSignature,
        expandedComponent,
        ...output
      } = element
      const children =
        sourceNodeId === undefined ? undefined : childIds.get(sourceNodeId)
      return children === undefined ? output : { ...output, children }
    }),
    rootChildren
  }
}

function itemLine(
  element: Element,
  frameWidth: number,
  frameHeight: number,
  indent = '  '
): string {
  const parts: Array<string> = []
  if (element.ref !== undefined) {
    parts.push(`ref: ${element.ref}`)
  }
  if (element.component !== undefined && element.component.length > 0) {
    parts.push(`component: ${yamlScalar(element.component)}`)
  } else {
    parts.push(`role: ${roleName(element.role)}`)
  }
  if (element.box !== undefined) {
    parts.push(`box: ${boxString(element.box, frameWidth, frameHeight)}`)
  }
  if (element.props !== undefined) {
    const pairs = Object.keys(element.props).map(
      (key) => `${key}: ${yamlScalar(element.props![key])}`
    )
    if (pairs.length > 0) {
      parts.push(`props: { ${pairs.join(', ')} }`)
    }
  }
  if (element.layout !== undefined) {
    parts.push(`layout: ${yamlScalar(layoutString(element.layout))}`)
  }
  if (element.padding !== undefined) {
    parts.push(`padding: ${paddingString(element.padding)}`)
  }
  if (element.overflow !== undefined) {
    parts.push(`overflow: ${element.overflow}`)
  }
  if (element.children !== undefined && element.children.length > 0) {
    parts.push(`children: [${element.children.join(', ')}]`)
  }
  if (element.columns !== undefined && element.columns.length > 0) {
    parts.push(`columns: [${element.columns.map(yamlScalar).join(', ')}]`)
  }
  if (element.cells !== undefined && element.cells.length > 0) {
    parts.push(`cells: [${element.cells.map(yamlScalar).join(', ')}]`)
  }
  if (element.rows !== undefined) {
    parts.push(`rows: ${element.rows}`)
  }
  if (element.count !== undefined) {
    parts.push(`count: ${element.count}`)
  }
  if (element.text !== undefined && element.text.length > 0) {
    parts.push(`text: ${yamlScalar(element.text)}`)
  }
  if (element.color !== undefined && element.color.length > 0) {
    parts.push(`color: ${yamlScalar(element.color)}`)
  }
  if (element.icons !== undefined && element.icons.length > 0) {
    parts.push(`icons: [${element.icons.map(yamlScalar).join(', ')}]`)
  }
  return `${indent}${element.id}: { ${parts.join(', ')} }`
}

// [x, y, w, h] as integer % of the frame. Position is rounded; width/height keep
// a 1% floor so a thin element still reads as a sliver, not a zero-size point.
function boxString(box: Box, frameWidth: number, frameHeight: number): string {
  const x = pct(box.x, frameWidth)
  const y = pct(box.y, frameHeight)
  const w = Math.max(1, pct(box.w, frameWidth))
  const h = Math.max(1, pct(box.h, frameHeight))
  return `[${x}, ${y}, ${w}, ${h}]`
}

function relativeBoxValues(box: Box, root: Box): [number, number, number, number] {
  return [
    pct(box.x - root.x, root.w),
    pct(box.y - root.y, root.h),
    Math.max(1, pct(box.w, root.w)),
    Math.max(1, pct(box.h, root.h))
  ]
}

function pct(value: number, total: number): number {
  if (total <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)))
}

function roleName(role: Role): string {
  if (role === 'row' || role === 'stack' || role === 'group') {
    return 'group'
  }
  return role
}

// Compact one-line layout: "row gap 8 between" / "col gap 24 align center wrap".
function layoutString(layout: NonNullable<Element['layout']>): string {
  const bits: Array<string> = [layout.dir]
  if (layout.gap !== undefined && layout.gap > 0) {
    bits.push(`gap ${layout.gap}`)
  }
  if (layout.justify !== undefined) {
    bits.push(layout.justify)
  }
  if (layout.align !== undefined) {
    bits.push(`align ${layout.align}`)
  }
  if (layout.wrap === true) {
    bits.push('wrap')
  }
  return bits.join(' ')
}

function paddingString(padding: NonNullable<Element['padding']>): string {
  return Array.isArray(padding) ? `[${padding.join(', ')}]` : String(padding)
}

// Bare scalar when it's safe; otherwise a double-quoted, escaped string. Text
// copy often contains punctuation/colons, so it usually quotes.
function yamlScalar(value: string): string {
  if (value.length === 0) {
    return '""'
  }
  if (/^[A-Za-z0-9 ._/-]+$/.test(value) && !/^\s|\s$/.test(value)) {
    return value
  }
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}
