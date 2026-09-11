import {
  ComponentDepth,
  ExtractionProgress,
  ScreenData,
  SelectionSummary
} from '../types'

export type UiViewState = 'empty' | 'ready' | 'extracting' | 'result' | 'error'

export interface UiSize {
  width: number
  height: number
}

export interface UiModel {
  view: UiViewState
  selection: SelectionSummary
  extractionSelection: SelectionSummary | null
  progress: ExtractionProgress | null
  screens: Array<ScreenData>
  markdown: string
  error: string
}

export type UiAction =
  | { type: 'selection'; selection: SelectionSummary }
  | { type: 'start' }
  | { type: 'progress'; progress: ExtractionProgress }
  | { type: 'success'; screens: Array<ScreenData>; markdown: string }
  | { type: 'failure'; message: string }
  | { type: 'new' }

export const initialUiModel: UiModel = {
  view: 'empty',
  selection: { frames: [], ignoredCount: 0, hasColorTokens: false },
  extractionSelection: null,
  progress: null,
  screens: [],
  markdown: '',
  error: ''
}

export function reduceUiModel(state: UiModel, action: UiAction): UiModel {
  if (action.type === 'selection') {
    const view =
      state.view === 'extracting' || state.view === 'result'
        ? state.view
        : action.selection.frames.length > 0
          ? 'ready'
          : 'empty'
    return { ...state, selection: action.selection, view }
  }
  if (action.type === 'start') {
    if (state.selection.frames.length === 0) {
      return state
    }
    return {
      ...state,
      view: 'extracting',
      extractionSelection: state.selection,
      progress: {
        current: 1,
        total: state.selection.frames.length,
        frameName: state.selection.frames[0].name
      },
      screens: [],
      markdown: '',
      error: ''
    }
  }
  if (action.type === 'progress') {
    return state.view === 'extracting' ? { ...state, progress: action.progress } : state
  }
  if (action.type === 'success') {
    if (action.markdown.trim().length === 0) {
      return {
        ...state,
        view: 'error',
        error: 'No Markdown was generated. Try another screen container.'
      }
    }
    return {
      ...state,
      view: 'result',
      progress: null,
      screens: action.screens,
      markdown: action.markdown,
      error: ''
    }
  }
  if (action.type === 'failure') {
    return { ...state, view: 'error', progress: null, error: action.message }
  }
  return {
    ...state,
    view: state.selection.frames.length > 0 ? 'ready' : 'empty',
    extractionSelection: null,
    progress: null,
    screens: [],
    markdown: '',
    error: ''
  }
}

export function deriveUiViewState(input: {
  busy: boolean
  error: string
  markdown: string
  validSelectionCount: number
}): UiViewState {
  if (input.busy) {
    return 'extracting'
  }
  if (input.error.length > 0) {
    return 'error'
  }
  if (input.markdown.length > 0) {
    return 'result'
  }
  return input.validSelectionCount > 0 ? 'ready' : 'empty'
}

export function isSupportedSelectionType(type: string): boolean {
  return (
    type === 'FRAME' ||
    type === 'COMPONENT' ||
    type === 'COMPONENT_SET' ||
    type === 'INSTANCE' ||
    type === 'SECTION'
  )
}

// Token names beat raw hex wherever the file actually has them, and beat a
// column of hex noise where it does not — so the selection picks, and the UI
// only overrides it once the user touches the control themselves.
export function defaultColorMode(selection: SelectionSummary): string {
  return selection.hasColorTokens ? 'Tokens' : 'Off'
}

export function componentDepthFromValue(value: string): ComponentDepth {
  if (value === '1' || value === '2' || value === '3' || value === '4') {
    return Number(value) as ComponentDepth
  }
  return 0
}

// The Agent Sim designs are a single 512x512 canvas that the three phases morph
// within, so the window must never resize between them: a resize would cut the
// card convergence and the code-window expansion in half.
export const UI_SIZE: UiSize = { width: 512, height: 512 }

// How long `extracting` stays on screen at minimum. The scan is the plugin's
// explanation of what it is doing, so it gets a floor even when extraction
// finishes instantly.
export const MIN_COMPACTING_MS = 2200

// A failure should not sit behind a reassuring scan for the full dwell.
export const MIN_FAILURE_MS = 700

// How long the merged window takes to grow into the file window. The file
// content is mounted only once that move is done, so it is never laid out
// inside a 153px box and then reflowed.
export const GROW_MS = 1100

export function getUiSize(view: UiViewState, selection: SelectionSummary): UiSize {
  return UI_SIZE
}
