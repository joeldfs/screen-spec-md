/// <reference types="@figma/plugin-typings" />
import { emit, on, showUI } from '@create-figma-plugin/utilities'

import { extractScreen, hasColorTokens } from './lib/extract'
import { buildMarkdown } from './lib/outline'
import { UI_SIZE, isSupportedSelectionType } from './lib/ui-state'
import {
  ColorMode,
  ComponentDepth,
  ErrorHandler,
  ProgressHandler,
  GenerateHandler,
  ResizeHandler,
  SelectionHandler,
  ScreenData,
  ScreensHandler,
  UiReadyHandler
} from './types'

export default function () {
  // Auto-prune hidden nodes during traversal so they never reach the outline.
  figma.skipInvisibleInstanceChildren = true

  if (figma.mode === 'codegen') {
    figma.codegen.on('generate', async function (event) {
      return [await generateCodegenResult(event.node)]
    })
    return
  }

  const sendSelection = function (): void {
    const selection = figma.currentPage.selection
    const frames = selection.filter(isUiScreen).map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      width: node.width,
      height: node.height
    }))
    emit<SelectionHandler>('SELECTION', {
      frames,
      ignoredCount: selection.length - frames.length,
      hasColorTokens: hasColorTokens(selection.filter(isUiScreen))
    })
  }

  on<UiReadyHandler>('UI_READY', sendSelection)
  on<ResizeHandler>('RESIZE', function ({ width, height }) {
    figma.ui.resize(width, height)
  })
  figma.on('selectionchange', sendSelection)

  on<GenerateHandler>('GENERATE', async function ({ colorMode, componentDepth }) {
    try {
      const screens = [...figma.currentPage.selection.filter(isUiScreen)]
      if (screens.length === 0) {
        emit<ErrorHandler>(
          'ERROR',
          'Select one or more frames, components, component sets, instances, or sections on the canvas.'
        )
        return
      }
      const result: Array<ScreenData> = []
      let index = 1
      for (const node of screens) {
        emit<ProgressHandler>('PROGRESS', {
          current: index,
          total: screens.length,
          frameName: node.name
        })
        result.push(
          await screenDataFromNode(node, index++, colorMode, componentDepth)
        )
      }
      emit<ScreensHandler>('SCREENS', result)
    } catch (error) {
      emit<ErrorHandler>(
        'ERROR',
        error instanceof Error ? error.message : String(error)
      )
    }
  })

  showUI(UI_SIZE)
}

async function generateCodegenResult(node: SceneNode): Promise<CodegenResult> {
  if (!isScreen(node)) {
    return codegenText(
      'Select a frame, component, component set, instance, or section to generate a Screen Spec MD outline.'
    )
  }
  try {
    const screen = await screenDataFromNode(node, 1, 'off', 0)
    return codegenText(buildMarkdown([screen]))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return codegenText(
      `Screen Spec MD could not generate Markdown.\n\n${message}`
    )
  }
}

function codegenText(code: string): CodegenResult {
  return {
    title: 'Screen Spec MD',
    code,
    language: 'PLAINTEXT'
  }
}

async function screenDataFromNode(
  node: SceneNode,
  index: number,
  colorMode: ColorMode,
  componentDepth: ComponentDepth
): Promise<ScreenData> {
  const { elements, frameWidth, frameHeight, layout, padding, overflow } =
    await extractScreen(node, colorMode, componentDepth)
  return {
    index,
    elements,
    frameWidth,
    frameHeight,
    layout,
    padding,
    overflow
  }
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

function isUiScreen(
  node: SceneNode
): node is
  | FrameNode
  | ComponentNode
  | ComponentSetNode
  | InstanceNode
  | SectionNode {
  return isSupportedSelectionType(node.type)
}
