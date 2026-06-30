import { Box, Element, Role, ScreenData } from '../types'

// One block per screen: a YAML list of the screen's elements in reading order.
// Each item says WHAT it is (role / component name, variant props, exact text,
// composed icons, layout intent) and WHERE it sits — box: [x, y, w, h] as % of
// the frame. That pins a name onto a spot in the accompanying screenshot: the
// screenshot carries the picture, this list carries everything pixels can't show
// (component identity, variants, exact copy). Generic "Screen N" headings;
// frame/layer names are never emitted.
export function buildMarkdown(screens: Array<ScreenData>): string {
  return screens.map(formatScreen).join('\n\n') + '\n'
}

function formatScreen(screen: ScreenData): string {
  // Number every placed element in reading order so an item has a stable ref.
  const elements = assignIds(screen.elements).filter(
    (element) => element.id !== undefined
  )
  const width = Math.round(screen.frameWidth)
  const height = Math.round(screen.frameHeight)
  const lines: Array<string> = [
    `## Screen ${screen.index} — ${width}×${height}`,
    '',
    '```yaml',
    '# box: [x, y, w, h] in % of frame',
    'items:'
  ]
  for (const element of elements) {
    lines.push(itemLine(element, screen.frameWidth, screen.frameHeight))
  }
  lines.push('```')
  return lines.join('\n')
}

function assignIds(elements: Array<Element>): Array<Element> {
  let next = 1
  return elements.map((element) =>
    element.box !== undefined ? { ...element, id: next++ } : element
  )
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
