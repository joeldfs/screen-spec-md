// Offline check for the Markdown output (no Figma needed).
// Run: npx --yes tsx scripts/selftest.ts
import { buildMarkdown } from '../src/lib/outline'
import { ScreenData } from '../src/types'

// Approximate geometry of the Tempo onboarding screen (390 x 844).
const tempo: ScreenData = {
  index: 1,
  frameWidth: 390,
  frameHeight: 844,
  componentNames: [],
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
      box: { x: 24, y: 744, w: 354, h: 92 },
      layout: { dir: 'row', gap: 12, justify: 'between', align: 'center' }
    },
    {
      role: 'button-secondary',
      text: 'Back',
      box: { x: 40, y: 760, w: 110, h: 64 },
      rounded: true
    },
    {
      role: 'button-primary',
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
  componentNames: ['Button', 'HabitCard'],
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
  componentNames: [],
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

console.log(buildMarkdown([tempo, list, dense]))
