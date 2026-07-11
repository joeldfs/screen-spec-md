import assert from 'node:assert/strict'

import { createMarkdownBlob, getMarkdownExport } from '../src/lib/export'
import {
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
assert.equal(isSupportedSelectionType('INSTANCE'), false)
assert.equal(isSupportedSelectionType('TEXT'), false)

const mixedSelection: SelectionSummary = {
  frames: [{ id: '1', name: 'Checkout', type: 'FRAME', width: 768, height: 945 }],
  ignoredCount: 2
}
const latestSelection: SelectionSummary = {
  frames: [{ id: '2', name: 'Account', type: 'SECTION', width: 1440, height: 1024 }],
  ignoredCount: 0
}

assert.deepEqual(getUiSize('empty', initialUiModel.selection), { width: 400, height: 340 })
assert.deepEqual(getUiSize('extracting', mixedSelection), { width: 400, height: 340 })
assert.deepEqual(getUiSize('result', mixedSelection), { width: 420, height: 560 })
assert.deepEqual(getUiSize('ready', mixedSelection), { width: 400, height: 340 })
assert.deepEqual(getUiSize('error', mixedSelection), { width: 400, height: 372 })

const threeFramesWithIgnored: SelectionSummary = {
  frames: [
    mixedSelection.frames[0],
    latestSelection.frames[0],
    { id: '3', name: 'Home', type: 'FRAME', width: 390, height: 844 }
  ],
  ignoredCount: 1
}
assert.deepEqual(getUiSize('ready', threeFramesWithIgnored), { width: 400, height: 364 })
assert.deepEqual(getUiSize('error', threeFramesWithIgnored), { width: 400, height: 396 })

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
  selection: { frames: [], ignoredCount: 3 }
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
