import { ExtractionProgress, ScreenData, SelectionSummary } from '../types'

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
  selection: { frames: [], ignoredCount: 0 },
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
        error: 'No Markdown was generated. Try another frame or section.'
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
  return type === 'FRAME' || type === 'SECTION'
}

export function getUiSize(view: UiViewState, selection: SelectionSummary): UiSize {
  if (view === 'result') {
    return { width: 420, height: 560 }
  }
  if (view === 'empty' || view === 'extracting') {
    return { width: 400, height: 340 }
  }

  const visibleRows = Math.min(selection.frames.length, 3)
  const ignoredHeight = selection.ignoredCount > 0 ? 16 : 0
  const overflowHeight = selection.frames.length > 3 ? 16 : 0
  const readyHeight = Math.max(
    340,
    Math.min(410, 270 + visibleRows * 26 + ignoredHeight + overflowHeight)
  )
  if (view === 'error') {
    return { width: 400, height: Math.min(470, readyHeight + 32) }
  }
  return { width: 400, height: readyHeight }
}
