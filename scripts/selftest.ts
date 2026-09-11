// Offline check for the Markdown output (no Figma needed).
// Run: npx --yes tsx scripts/selftest.ts
import assert from 'node:assert/strict'

import { buildMarkdown } from '../src/lib/outline'
import { ScreenData } from '../src/types'

// Approximate geometry of the Tempo onboarding screen (390 x 844).
const tempo: ScreenData = {
  index: 1,
  frameWidth: 390,
  frameHeight: 844,
  layout: { dir: 'col', gap: 24 },
  padding: [20, 24],
  overflow: 'clip',
  elements: [
    { role: 'caption', text: '9:41', box: { x: 24, y: 20, w: 44, h: 20 } },
    { role: 'caption', text: 'Tempo', box: { x: 300, y: 20, w: 64, h: 20 } },
    { role: 'progress', box: { x: 24, y: 64, w: 342, h: 8 } },
    { role: 'image', box: { x: 120, y: 150, w: 150, h: 150 }, rounded: true },
    { role: 'eyebrow', text: 'STEP 1 OF 3', box: { x: 40, y: 430, w: 130, h: 16 } },
    {
      role: 'heading',
      text: 'Build a calmer routine',
      box: { x: 40, y: 460, w: 300, h: 96 }
    },
    {
      role: 'body',
      text: 'Tempo turns one tiny daily promise into a **rhythm** you can actually keep.',
      box: { x: 40, y: 572, w: 320, h: 60 }
    },
    {
      role: 'group',
      sourceNodeId: 'footer-actions',
      box: { x: 24, y: 744, w: 354, h: 92 },
      layout: { dir: 'row', gap: 12, justify: 'between', align: 'center' }
    },
    {
      role: 'button-secondary',
      parentSourceNodeId: 'footer-actions',
      text: 'Back',
      box: { x: 40, y: 760, w: 110, h: 64 },
      rounded: true
    },
    {
      role: 'button-primary',
      parentSourceNodeId: 'footer-actions',
      text: 'Start with one habit',
      box: { x: 170, y: 760, w: 200, h: 64 }
    }
  ]
}

// A screen that uses component instances.
const list: ScreenData = {
  index: 2,
  frameWidth: 390,
  frameHeight: 600,
  elements: [
    { role: 'heading', text: 'Today', box: { x: 24, y: 40, w: 160, h: 40 } },
    {
      role: 'component',
      component: 'HabitCard',
      props: { state: 'checked', size: 'lg' },
      text: 'Drink water',
      box: { x: 24, y: 100, w: 342, h: 72 },
      rounded: true,
      icons: ['icon', 'icon', 'icon', 'icon', 'icon']
    },
    {
      role: 'component',
      component: 'HabitCard',
      props: { state: 'default', size: 'lg' },
      text: 'Stretch',
      box: { x: 24, y: 184, w: 342, h: 72 },
      rounded: true
    },
    { role: 'image', box: { x: 24, y: 300, w: 342, h: 90 } },
    {
      role: 'button-primary',
      text: 'Add habit',
      box: { x: 24, y: 520, w: 342, h: 56 }
    }
  ]
}

// A dense screen exercising the badge role and a collapsed data table.
const dense: ScreenData = {
  index: 3,
  frameWidth: 1000,
  frameHeight: 800,
  elements: [
    {
      role: 'badge',
      text: 'Done',
      box: { x: 120, y: 40, w: 64, h: 22 },
      rounded: true,
      color: 'success'
    },
    {
      role: 'table',
      box: { x: 40, y: 80, w: 920, h: 600 },
      columns: ['Header', 'Section Type', 'Status', 'Target', 'Limit', 'Reviewer'],
      cells: [
        'lucide/grip-vertical',
        'text',
        'badge',
        'status',
        'number',
        'number',
        'text',
        'lucide/ellipsis-vertical'
      ],
      rows: 10
    },
    {
      role: 'body',
      text: 'Dashboard',
      box: { x: 40, y: 700, w: 160, h: 20 },
      icons: ['lucide/layout-dashboard']
    },
    {
      role: 'cards',
      box: { x: 40, y: 730, w: 920, h: 40 },
      count: 4,
      cells: ['text', 'lucide/trending-up', 'number', 'number', 'text']
    },
    {
      role: 'tabs',
      box: { x: 40, y: 60, w: 400, h: 16 },
      text: 'Outline Past Performance Key Personnel Focus Documents'
    },
    {
      role: 'input',
      text: 'm@example.com',
      box: { x: 40, y: 770, w: 300, h: 24 },
      rounded: true
    },
    {
      role: 'avatar',
      text: 'SJ',
      box: { x: 40, y: 800, w: 40, h: 40 },
      rounded: true,
      color: '#2563eb'
    }
  ]
}

const baseMarkdown = buildMarkdown([tempo, list, dense])
assert.equal(baseMarkdown.includes('## Reusable components'), false)
assert.equal(baseMarkdown.includes('ref: C'), false)

function expandedActionSheet(
  suffix: string,
  offsetX: number,
  title: string
): Array<ScreenData['elements'][number]> {
  const actionId = `action-${suffix}`
  const groupId = `group-${suffix}`
  const buttonId = `button-${suffix}`
  return [
    {
      role: 'component',
      component: 'Action Sheet',
      componentKey: 'component:action-sheet',
      componentSignature: '[["Mode","VARIANT","Light"]]',
      expandedComponent: true,
      props: { Mode: 'Light' },
      sourceNodeId: actionId,
      box: { x: offsetX, y: 40, w: 300, h: 296 },
      layout: { dir: 'col', justify: 'center' },
      padding: 14
    },
    {
      role: 'group',
      sourceNodeId: groupId,
      parentSourceNodeId: actionId,
      box: { x: offsetX + 15, y: 55, w: 270, h: 105 },
      layout: { dir: 'col', gap: 10, align: 'center' }
    },
    {
      role: 'body',
      parentSourceNodeId: groupId,
      text: title,
      box: { x: offsetX + 20, y: 60, w: 255, h: 22 }
    },
    {
      role: 'component',
      component: 'Button',
      componentKey: 'component:button',
      componentSignature: '[["Style","VARIANT","Destructive"]]',
      expandedComponent: true,
      props: { Style: 'Destructive' },
      sourceNodeId: buttonId,
      parentSourceNodeId: actionId,
      box: { x: offsetX + 20, y: 230, w: 260, h: 48 },
      layout: { dir: 'row', justify: 'center', align: 'center' }
    },
    {
      role: 'body',
      parentSourceNodeId: buttonId,
      text: 'Destructive Action',
      box: { x: offsetX + 50, y: 244, w: 200, h: 20 }
    }
  ]
}

const reused: Array<ScreenData> = [
  {
    index: 1,
    frameWidth: 405,
    frameHeight: 476,
    elements: expandedActionSheet('one', 48, 'A Short Title Is Best')
  },
  {
    index: 2,
    frameWidth: 405,
    frameHeight: 476,
    elements: expandedActionSheet('two', 72, 'A Short Title Is Best')
  },
  {
    index: 3,
    frameWidth: 405,
    frameHeight: 476,
    elements: expandedActionSheet('three', 24, 'A Different Title')
  }
]
const reusedMarkdown = buildMarkdown(reused)
const outerOnlyMarkdown = buildMarkdown(reused.slice(0, 2))
assert.match(outerOnlyMarkdown, /  C1:\n    component: Action Sheet/)
assert.equal(outerOnlyMarkdown.includes('  C2:'), false)
assert.equal((outerOnlyMarkdown.match(/ref: C1/g) ?? []).length, 2)

assert.match(reusedMarkdown, /## Reusable components/)
assert.match(reusedMarkdown, /  C1:\n    component: Action Sheet/)
assert.match(reusedMarkdown, /  C2:\n    component: Button/)
assert.equal((reusedMarkdown.match(/ref: C1/g) ?? []).length, 2)
assert.equal((reusedMarkdown.match(/ref: C2/g) ?? []).length, 2)
assert.match(reusedMarkdown, /box: \[7, 7, 85, 7\], text: A Short Title Is Best/)
assert.match(
  reusedMarkdown,
  /component: Action Sheet, box: \[6, 8, 74, 62\].*A Different Title/s
)

console.log(baseMarkdown)
console.log('Markdown self-test passed')
