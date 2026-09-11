import assert from 'node:assert/strict'

import { createMarkdownBlob, getMarkdownExport } from '../src/lib/export'
import {
  MIN_COMPACTING_MS,
  MIN_FAILURE_MS,
  UI_SIZE,
  UiViewState,
  componentDepthFromValue,
  defaultColorMode,
  deriveUiViewState,
  getUiSize,
  initialUiModel,
  isSupportedSelectionType,
  reduceUiModel
} from '../src/lib/ui-state'
import { SelectionSummary } from '../src/types'

assert.equal(
  deriveUiViewState({ busy: false, error: '', markdown: '', validSelectionCount: 0 }),
  'empty'
)
assert.equal(
  deriveUiViewState({ busy: false, error: '', markdown: '', validSelectionCount: 2 }),
  'ready'
)
assert.equal(
  deriveUiViewState({ busy: true, error: '', markdown: '', validSelectionCount: 1 }),
  'extracting'
)
assert.equal(
  deriveUiViewState({ busy: false, error: '', markdown: '# Screen', validSelectionCount: 0 }),
  'result'
)
assert.equal(
  deriveUiViewState({
    busy: false,
    error: 'Extraction failed',
    markdown: '# stale',
    validSelectionCount: 1
  }),
  'error'
)
assert.equal(
  deriveUiViewState({ busy: true, error: 'pending', markdown: '', validSelectionCount: 1 }),
  'extracting'
)

assert.equal(isSupportedSelectionType('FRAME'), true)
assert.equal(isSupportedSelectionType('SECTION'), true)
assert.equal(isSupportedSelectionType('COMPONENT'), true)
assert.equal(isSupportedSelectionType('COMPONENT_SET'), true)
assert.equal(isSupportedSelectionType('INSTANCE'), true)
assert.equal(isSupportedSelectionType('TEXT'), false)
assert.equal(componentDepthFromValue('Base'), 0)
assert.equal(componentDepthFromValue('1'), 1)
assert.equal(componentDepthFromValue('4'), 4)
assert.equal(componentDepthFromValue('unexpected'), 0)

const directComponentSelection: SelectionSummary = {
  frames: [
    { id: 'component:1', name: 'Button', type: 'COMPONENT', width: 120, height: 40 }
  ],
  ignoredCount: 0,
  hasColorTokens: false
}
assert.equal(
  reduceUiModel(initialUiModel, {
    type: 'selection',
    selection: directComponentSelection
  }).view,
  'ready'
)

const mixedSelection: SelectionSummary = {
  frames: [{ id: '1', name: 'Checkout', type: 'FRAME', width: 768, height: 945 }],
  ignoredCount: 2,
  hasColorTokens: true
}
const latestSelection: SelectionSummary = {
  frames: [{ id: '2', name: 'Account', type: 'SECTION', width: 1440, height: 1024 }],
  ignoredCount: 0,
  hasColorTokens: false
}


const threeFramesWithIgnored: SelectionSummary = {
  frames: [
    mixedSelection.frames[0],
    latestSelection.frames[0],
    { id: '3', name: 'Home', type: 'FRAME', width: 390, height: 844 }
  ],
  ignoredCount: 1,
  hasColorTokens: false
}
const overflowingSelection: SelectionSummary = {
  frames: [
    ...threeFramesWithIgnored.frames,
    { id: '4', name: 'Settings', type: 'FRAME', width: 1440, height: 1024 }
  ],
  ignoredCount: 2,
  hasColorTokens: true
}

// The canvas is one fixed 512x512 surface that every phase morphs within, so
// the window must not resize for any view or any selection shape: a resize
// mid-transition would cut the card convergence and the code-window expansion
// in half.
const everyView: Array<UiViewState> = ['empty', 'ready', 'extracting', 'result', 'error']
const everySelection: Array<SelectionSummary> = [
  initialUiModel.selection,
  directComponentSelection,
  mixedSelection,
  latestSelection,
  threeFramesWithIgnored,
  overflowingSelection
]
for (const view of everyView) {
  for (const candidate of everySelection) {
    assert.deepEqual(getUiSize(view, candidate), { width: 512, height: 512 })
  }
}
assert.deepEqual(UI_SIZE, { width: 512, height: 512 })

// The scan is how the plugin explains itself, so it outlives a fast extraction,
// and a failure is not held behind that full dwell.
assert.ok(MIN_COMPACTING_MS > MIN_FAILURE_MS)
assert.ok(MIN_FAILURE_MS > 0)

// Color output defaults itself from the selection: token names where the file
// binds them, and Off rather than a wall of raw hex where it does not.
assert.equal(defaultColorMode(mixedSelection), 'Tokens')
assert.equal(defaultColorMode(directComponentSelection), 'Off')
assert.equal(defaultColorMode(initialUiModel.selection), 'Off')

let model = reduceUiModel(initialUiModel, { type: 'selection', selection: mixedSelection })
assert.equal(model.view, 'ready')
assert.equal(model.selection.ignoredCount, 2)

model = reduceUiModel(model, { type: 'start' })
assert.equal(model.view, 'extracting')
assert.equal(model.extractionSelection?.frames[0].name, 'Checkout')

model = reduceUiModel(model, { type: 'selection', selection: latestSelection })
assert.equal(model.view, 'extracting')
assert.equal(model.selection.frames[0].name, 'Account')
assert.equal(model.extractionSelection?.frames[0].name, 'Checkout')

model = reduceUiModel(model, {
  type: 'progress',
  progress: { current: 1, total: 1, frameName: 'Checkout' }
})
assert.equal(model.progress?.frameName, 'Checkout')

model = reduceUiModel(model, { type: 'failure', message: 'Could not read frame' })
assert.equal(model.view, 'error')
assert.equal(model.selection.frames[0].name, 'Account')

model = reduceUiModel(model, { type: 'start' })
assert.equal(model.view, 'extracting')
assert.equal(model.extractionSelection?.frames[0].name, 'Account')

model = reduceUiModel(model, {
  type: 'success',
  markdown: '# Screen',
  screens: [{ index: 1, elements: [], frameWidth: 1440, frameHeight: 1024 }]
})
assert.equal(model.view, 'result')
assert.equal(model.markdown, '# Screen')

model = reduceUiModel(model, { type: 'new' })
assert.equal(model.view, 'ready')
assert.equal(model.selection.frames[0].name, 'Account')

const emptyResult = reduceUiModel(reduceUiModel(model, { type: 'start' }), {
  type: 'success',
  markdown: '   ',
  screens: []
})
assert.equal(emptyResult.view, 'error')
assert.equal(emptyResult.markdown, '')

const unsupportedOnly = reduceUiModel(initialUiModel, {
  type: 'selection',
  selection: { frames: [], ignoredCount: 3, hasColorTokens: false }
})
assert.equal(unsupportedOnly.view, 'empty')

const markdown = '# screens.md\n\nExact export payload.'
assert.equal(getMarkdownExport(markdown), markdown)
createMarkdownBlob(markdown)
  .text()
  .then(function (downloadText) {
    assert.equal(downloadText, getMarkdownExport(markdown))
    console.log('UI state self-test passed')
  })
  .catch(function (error) {
    console.error(error)
    process.exitCode = 1
  })
