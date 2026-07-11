import { EventHandler } from '@create-figma-plugin/utilities'

export type Role =
  | 'heading'
  | 'subheading'
  | 'eyebrow'
  | 'body'
  | 'caption'
  | 'button-primary'
  | 'button-secondary'
  | 'badge'
  | 'input'
  | 'image'
  | 'avatar'
  | 'icon'
  | 'progress'
  | 'chart'
  | 'table'
  | 'cards'
  | 'tabs'
  | 'status-bar'
  | 'row'
  | 'stack'
  | 'group'
  | 'component'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Element {
  role: Role
  // Small per-screen tag (1, 2, 3 …) shown on the ASCII box and keyed in the
  // YAML legend, so a box in the diagram resolves to its component entry.
  id?: number
  text?: string
  component?: string
  // Resolved fill/text color when color extraction is on: a design-token name
  // (bound variable or color style) or a raw hex fallback. Omitted when off.
  color?: string
  // Icon children worth naming (e.g. the nav icons inside a sidebar). Listed in
  // the YAML under this element's id rather than drawn in the ASCII.
  icons?: Array<string>
  // Variant selections on a component instance (e.g. { size: 'lg', state:
  // 'default' }). Tells the LLM *which* variant of the repo component to use,
  // not just its name. Only set for component elements.
  props?: { [name: string]: string }
  // Auto-layout intent for a structural container (Figma layoutMode/spacing/
  // alignment). Captures composition the geometry can't show — e.g. "ends pinned"
  // (justify between) or "fills" — and is device-independent. Set on group boxes.
  layout?: {
    dir: 'row' | 'col'
    gap?: number
    justify?: string
    align?: string
    wrap?: boolean
  }
  // Non-zero container inset, compacted as all / vertical-horizontal /
  // top-right-bottom-left. Values are observed Figma pixels; token mapping is a
  // downstream codebase concern unless Figma exposes a bound variable.
  padding?: number | [number, number] | [number, number, number, number]
  overflow?: 'clip'
  // Collapsed data-table summary: column headers, the row shape (what each cell
  // renders, left-to-right), and the visible row count. Set only for `table`.
  columns?: Array<string>
  cells?: Array<string>
  rows?: number
  count?: number
  box?: Box
  rounded?: boolean
  // Output-only ownership references. Internal source ids are stripped by the
  // Markdown formatter after stable numeric ids have been assigned.
  children?: Array<number>
  sourceNodeId?: string
  parentSourceNodeId?: string
}

export interface ScreenData {
  index: number
  elements: Array<Element>
  frameWidth: number
  frameHeight: number
  layout?: Element['layout']
  padding?: Element['padding']
  overflow?: Element['overflow']
}

// How to surface colors: omit them (default), prefer design-token names (bound
// variable/style) with a raw-hex fallback, or always raw hex.
export type ColorMode = 'off' | 'tokens' | 'hex'

export interface GenerateHandler extends EventHandler {
  name: 'GENERATE'
  handler: (colorMode: ColorMode) => void
}

export interface ScreensHandler extends EventHandler {
  name: 'SCREENS'
  handler: (screens: Array<ScreenData>) => void
}

export interface ErrorHandler extends EventHandler {
  name: 'ERROR'
  handler: (message: string) => void
}
