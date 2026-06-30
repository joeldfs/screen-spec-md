/// <reference types="@figma/plugin-typings" />
import { emit, on, showUI } from '@create-figma-plugin/utilities'

import { extractScreen } from './lib/extract'
import { ErrorHandler, GenerateHandler, ScreenData, ScreensHandler } from './types'

export default function () {
  // Auto-prune hidden nodes during traversal so they never reach the outline.
  figma.skipInvisibleInstanceChildren = true

  on<GenerateHandler>('GENERATE', async function (colorMode) {
    try {
      const screens = figma.currentPage.selection.filter(isScreen)
      if (screens.length === 0) {
        emit<ErrorHandler>(
          'ERROR',
          'Select one or more frames on the canvas, then click Generate.'
        )
        return
      }
      const result: Array<ScreenData> = []
      let index = 1
      for (const node of screens) {
        const { elements, componentNames, frameWidth, frameHeight } =
          await extractScreen(node, colorMode)
        result.push({
          index: index++,
          elements,
          componentNames,
          frameWidth,
          frameHeight
        })
      }
      emit<ScreensHandler>('SCREENS', result)
    } catch (error) {
      emit<ErrorHandler>(
        'ERROR',
        error instanceof Error ? error.message : String(error)
      )
    }
  })

  showUI({ width: 420, height: 600 })
}

function isScreen(node: SceneNode): boolean {
  return (
    node.type === 'FRAME' ||
    node.type === 'COMPONENT' ||
    node.type === 'COMPONENT_SET' ||
    node.type === 'INSTANCE' ||
    node.type === 'SECTION'
  )
}
