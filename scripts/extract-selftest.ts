/// <reference types="@figma/plugin-typings" />
import assert from 'node:assert/strict'

import { extractScreen } from '../src/lib/extract'

;(globalThis as unknown as { figma: Partial<PluginAPI> }).figma = {
  mixed: Symbol('mixed')
}

function geometry(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    width,
    height,
    absoluteBoundingBox: { x, y, width, height },
    visible: true,
    opacity: 1,
    fills: [],
    strokes: [],
    cornerRadius: 0,
    clipsContent: false
  }
}

function textNode(
  id: string,
  text: string,
  x: number,
  y: number,
  size: number
): TextNode {
  return {
    ...geometry(x, y, 180, 22),
    id,
    name: id,
    type: 'TEXT',
    characters: text,
    fontSize: size,
    fontName: { family: 'Inter', style: 'Regular' },
    textCase: 'ORIGINAL',
    textStyleId: '',
    getStyledTextSegments: () => [
      { characters: text, fontName: { family: 'Inter', style: 'Regular' } }
    ]
  } as unknown as TextNode
}

function instanceNode(input: {
  id: string
  name: string
  componentId: string
  x: number
  y: number
  width: number
  height: number
  children: Array<SceneNode>
  property?: string
}): InstanceNode {
  const main = {
    id: input.componentId,
    name: input.name,
    parent: null
  } as unknown as ComponentNode
  return {
    ...geometry(input.x, input.y, input.width, input.height),
    id: input.id,
    name: input.name,
    type: 'INSTANCE',
    children: input.children,
    cornerRadius: 12,
    clipsContent: true,
    layoutMode: 'VERTICAL',
    itemSpacing: 10,
    paddingTop: 14,
    paddingRight: 14,
    paddingBottom: 14,
    paddingLeft: 14,
    primaryAxisAlignItems: 'CENTER',
    counterAxisAlignItems: 'CENTER',
    layoutWrap: 'NO_WRAP',
    componentProperties: input.property
      ? { Mode: { type: 'VARIANT', value: input.property } }
      : {},
    getMainComponentAsync: async () => main
  } as unknown as InstanceNode
}

const buttonLabel = textNode('button-label', 'Destructive Action', 110, 250, 14)
const button = instanceNode({
  id: 'button',
  name: 'Button',
  componentId: 'main-button',
  x: 70,
  y: 235,
  width: 260,
  height: 48,
  children: [buttonLabel],
  property: 'Destructive'
})
const title = textNode('title', 'A Short Title Is Best', 80, 70, 20)
const actionSheet = instanceNode({
  id: 'action-sheet',
  name: 'Action Sheet',
  componentId: 'main-action-sheet',
  x: 50,
  y: 35,
  width: 300,
  height: 296,
  children: [title, button],
  property: 'Light'
})
const frame = {
  ...geometry(0, 0, 405, 476),
  id: 'frame',
  name: 'Frame',
  type: 'FRAME',
  children: [actionSheet],
  layoutMode: 'NONE'
} as unknown as FrameNode

const emptyInstance = instanceNode({
  id: 'empty',
  name: 'Empty State',
  componentId: 'main-empty',
  x: 20,
  y: 20,
  width: 120,
  height: 80,
  children: []
})
const emptyFrame = {
  ...geometry(0, 0, 200, 160),
  id: 'empty-frame',
  name: 'Empty Frame',
  type: 'FRAME',
  children: [emptyInstance],
  layoutMode: 'NONE'
} as unknown as FrameNode

let deepChild: SceneNode = textNode('deep-label', 'Deep label', 60, 60, 12)
for (let level = 5; level >= 1; level--) {
  deepChild = instanceNode({
    id: `deep-${level}`,
    name: `Level ${level}`,
    componentId: `main-level-${level}`,
    x: 10 * level,
    y: 10 * level,
    width: 180 - level * 10,
    height: 140 - level * 10,
    children: [deepChild]
  })
}
const deepFrame = {
  ...geometry(0, 0, 240, 200),
  id: 'deep-frame',
  name: 'Deep Frame',
  type: 'FRAME',
  children: [deepChild],
  layoutMode: 'NONE'
} as unknown as FrameNode

const incompleteFontText = {
  ...textNode('incomplete-font', 'Runtime font fallback', 10, 10, 16),
  fontName: { family: 'Inter' },
  getStyledTextSegments: () => [
    { characters: 'Runtime ', fontName: { family: 'Inter' } },
    { characters: 'font fallback', fontName: { family: 'Inter' } }
  ]
} as unknown as TextNode
const incompleteFontFrame = {
  ...geometry(0, 0, 240, 100),
  id: 'incomplete-font-frame',
  name: 'Incomplete Font Frame',
  type: 'FRAME',
  children: [incompleteFontText],
  layoutMode: 'NONE'
} as unknown as FrameNode

async function run(): Promise<void> {
  const base = await extractScreen(frame, 'off', 0)
  assert.equal(base.elements.length, 1)
  assert.equal(base.elements[0].component, 'Action Sheet')
  assert.equal(base.elements[0].expandedComponent, undefined)
  assert.equal(
    base.elements[0].text,
    'A Short Title Is Best Destructive Action'
  )

  const levelOne = await extractScreen(frame, 'off', 1)
  assert.equal(levelOne.elements[0].component, 'Action Sheet')
  assert.equal(levelOne.elements[0].expandedComponent, true)
  assert.equal(levelOne.elements[0].text, undefined)
  assert.deepEqual(levelOne.elements[0].layout, {
    dir: 'col',
    gap: 10,
    justify: 'center',
    align: 'center'
  })
  assert.equal(levelOne.elements[1].text, 'A Short Title Is Best')
  assert.equal(levelOne.elements[1].role, 'heading')
  assert.equal(levelOne.elements[2].component, 'Button')
  assert.equal(levelOne.elements[2].expandedComponent, undefined)
  assert.equal(levelOne.elements[2].text, 'Destructive Action')

  const levelTwo = await extractScreen(frame, 'off', 2)
  assert.equal(levelTwo.elements[2].component, 'Button')
  assert.equal(levelTwo.elements[2].expandedComponent, true)
  assert.equal(levelTwo.elements[2].text, undefined)
  assert.equal(levelTwo.elements[3].text, 'Destructive Action')
  assert.equal(levelTwo.elements[3].parentSourceNodeId, 'button')

  const directBase = await extractScreen(actionSheet, 'off', 0)
  assert.equal(directBase.elements[0].text, 'A Short Title Is Best')
  assert.equal(directBase.elements[1].component, 'Button')
  assert.equal(directBase.elements[1].expandedComponent, undefined)

  const emptyExpanded = await extractScreen(emptyFrame, 'off', 4)
  assert.equal(emptyExpanded.elements.length, 1)
  assert.equal(emptyExpanded.elements[0].component, 'Empty State')
  assert.equal(emptyExpanded.elements[0].expandedComponent, undefined)

  for (const depth of [1, 2, 3, 4] as const) {
    const deepResult = await extractScreen(deepFrame, 'off', depth)
    assert.equal(
      deepResult.elements.filter((element) => element.expandedComponent === true)
        .length,
      depth
    )
    assert.equal(deepResult.elements[depth].expandedComponent, undefined)
  }

  const incompleteFontResult = await extractScreen(incompleteFontFrame, 'off', 0)
  assert.equal(incompleteFontResult.elements[0].text, 'Runtime font fallback')

  console.log('Extraction depth self-test passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
