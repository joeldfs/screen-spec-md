import { Box, Element, Role, ScreenData } from '../types'

const INTERPRETATION_GUIDE =
  '> AI interpretation: Implement these screens with the codebase\'s existing ' +
  'components and tokens. `box` is `[x, y, w, h]` in screen percentages; ' +
  'gaps and padding are Figma pixels; `children` defines ownership. Treat ' +
  'component entries as reusable boundaries, preserve text and props exactly, ' +
  'and use any supplied screenshot for visual details.'

// One block per screen: a YAML list of the screen's elements in reading order.
// Each item says WHAT it is (role / component name, variant props, exact text,
// composed icons, layout intent) and WHERE it sits — box: [x, y, w, h] as % of
// the frame. That pins a name onto a spot in the accompanying screenshot: the
// screenshot carries the picture, this list carries everything pixels can't show
// (component identity, variants, exact copy). Generic "Screen N" headings;
// frame/layer names are never emitted.
export function buildMarkdown(screens: Array<ScreenData>): string {
  return INTERPRETATION_GUIDE + '\n\n' + screens.map(formatScreen).join('\n\n') + '\n'
}

function formatScreen(screen: ScreenData): string {
  // Number every placed element in reading order so an item has a stable ref.
  const assigned = assignIds(screen.elements)
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
      const { sourceNodeId, parentSourceNodeId, ...output } = element
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
  frameHeight: number
): string {
  const parts: Array<string> = []
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
  return `  ${element.id}: { ${parts.join(', ')} }`
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
