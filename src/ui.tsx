import {
  IconCheck16,
  IconExportSmall24,
  IconRefresh16,
  IconWarningSmall24,
  render
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { RefObject, h } from 'preact'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks'

import copyIcon from '../assets/figma/icon-copy.svg'
import copyScanAccent from '../assets/figma/icon-copy-scan.svg'
import cursorAccent from '../assets/figma/icon-cursor-edit.svg'
import fitBlueAccent from '../assets/figma/icon-fit-to-screen-blue.svg'
import fitAccent from '../assets/figma/icon-fit-to-screen.svg'
import screenshotAmberAccent from '../assets/figma/icon-screenshot-amber.svg'
import screenshotAccent from '../assets/figma/icon-screenshot.svg'
import terminalIcon from '../assets/figma/icon-terminal.svg'
import terminalAccent from '../assets/figma/icon-terminal-accent.svg'
import terminalVioletAccent from '../assets/figma/icon-terminal-violet.svg'
import { createMarkdownBlob, getMarkdownExport } from './lib/export'
import { buildMarkdown } from './lib/outline'
import {
  GROW_MS,
  MIN_COMPACTING_MS,
  MIN_FAILURE_MS,
  UiViewState,
  componentDepthFromValue,
  defaultColorMode,
  getUiSize,
  initialUiModel,
  reduceUiModel
} from './lib/ui-state'
import styles from './ui.module.css'
import {
  ColorMode,
  ErrorHandler,
  ExtractionProgress,
  GenerateHandler,
  ProgressHandler,
  ResizeHandler,
  ScreenData,
  ScreensHandler,
  SelectionHandler,
  SelectionSummary,
  UiReadyHandler
} from './types'

const colorOptions = ['Off', 'Tokens', 'Hex']
const componentDepthOptions = ['Base', '1', '2', '3', '4']

// The canvas phase, which is coarser than the view state: `error` reuses the
// settings canvas and only adds a banner.
type Phase = 'select' | 'settings' | 'scanning' | 'codeblock'

function phaseFor(view: UiViewState): Phase {
  if (view === 'extracting') {
    return 'scanning'
  }
  if (view === 'result') {
    return 'codeblock'
  }
  return view === 'empty' ? 'select' : 'settings'
}

function Plugin() {
  const [model, dispatch] = useReducer(reduceUiModel, initialUiModel)
  const [copied, setCopied] = useState(false)
  // Split out of the phase: the front window starts growing while the scan is
  // still the current view, so the expansion reads as one continuous move.
  const [growing, setGrowing] = useState(false)
  const [colorMode, setColorMode] = useState('Off')
  // Once the user picks a Color output themselves, the selection stops choosing
  // for them — otherwise switching frames would silently undo their choice.
  const [colorModeChosen, setColorModeChosen] = useState(false)
  const [componentDepth, setComponentDepth] = useState('Base')
  const copyAreaRef = useRef<HTMLTextAreaElement>(null)
  const headingRef = useRef<HTMLElement>(null)
  // Wall-clock start of the current extraction, so the scan gets its full dwell
  // even when the work itself finishes in a few milliseconds.
  const startedAtRef = useRef(0)
  const timersRef = useRef<Array<number>>([])
  const { error, markdown, progress, screens, selection, view } = model
  const phase = phaseFor(view)
  // The message handlers are registered once, so they read the live view from a
  // ref rather than from their own stale closure.
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(function () {
    const clearTimers = function () {
      for (const timer of timersRef.current) {
        window.clearTimeout(timer)
      }
      timersRef.current = []
    }
    const after = function (delay: number, apply: () => void) {
      timersRef.current.push(window.setTimeout(apply, delay))
    }
    const settleAfter = function (floor: number, apply: () => void) {
      clearTimers()
      after(Math.max(0, floor - (Date.now() - startedAtRef.current)), apply)
    }
    const removeSelection = on<SelectionHandler>('SELECTION', function (next) {
      dispatch({ type: 'selection', selection: next })
    })
    const removeProgress = on<ProgressHandler>('PROGRESS', function (next) {
      dispatch({ type: 'progress', progress: next })
    })
    const removeScreens = on<ScreensHandler>('SCREENS', function (nextScreens) {
      const md = buildMarkdown(nextScreens)
      const settle = function () {
        dispatch({ type: 'success', screens: nextScreens, markdown: md })
        setCopied(false)
      }
      // Only a scan in flight earns the grow choreography. Screens arriving from
      // anywhere else would otherwise expand the window while the settings are
      // still on top of it.
      if (viewRef.current !== 'extracting') {
        clearTimers()
        setGrowing(false)
        settle()
        return
      }
      settleAfter(MIN_COMPACTING_MS, function () {
        // Grow first, mount the file content once it has the room.
        setGrowing(true)
        after(GROW_MS, settle)
      })
    })
    const removeError = on<ErrorHandler>('ERROR', function (message) {
      settleAfter(MIN_FAILURE_MS, function () {
        setGrowing(false)
        dispatch({ type: 'failure', message })
      })
    })
    emit<UiReadyHandler>('UI_READY')
    return function () {
      clearTimers()
      removeSelection()
      removeProgress()
      removeScreens()
      removeError()
    }
  }, [])

  useEffect(
    function () {
      headingRef.current?.focus()
    },
    [view]
  )

  useEffect(
    function () {
      emit<ResizeHandler>('RESIZE', getUiSize(view, selection))
    },
    [selection, view]
  )

  // Token names are the more useful output whenever the file actually has them,
  // so the selection sets the default and says nothing about it. Files with no
  // bound colours fall back to Off rather than to a column of raw hex.
  useEffect(
    function () {
      if (colorModeChosen) {
        return
      }
      setColorMode(defaultColorMode(selection))
    },
    [colorModeChosen, selection]
  )

  const chooseColorMode = useCallback(function (value: string) {
    setColorModeChosen(true)
    setColorMode(value)
  }, [])

  const handleGenerate = useCallback(
    function () {
      if (selection.frames.length === 0) {
        return
      }
      setCopied(false)
      setGrowing(false)
      startedAtRef.current = Date.now()
      dispatch({ type: 'start' })
      emit<GenerateHandler>('GENERATE', {
        colorMode: colorMode.toLowerCase() as ColorMode,
        componentDepth: componentDepthFromValue(componentDepth)
      })
    },
    [colorMode, componentDepth, selection]
  )

  const handleCopy = useCallback(
    async function () {
      const node = copyAreaRef.current
      if (node === null || !markdown) {
        return
      }
      const payload = getMarkdownExport(markdown)
      try {
        if (navigator.clipboard?.writeText !== undefined) {
          await navigator.clipboard.writeText(payload)
        } else {
          node.focus()
          node.select()
          if (!document.execCommand('copy')) {
            throw new Error('Copy command was rejected')
          }
        }
        setCopied(true)
        window.setTimeout(function () {
          setCopied(false)
        }, 1600)
      } catch {
        node.focus()
        node.select()
        setCopied(document.execCommand('copy'))
      }
    },
    [markdown]
  )

  const reset = useCallback(function () {
    setGrowing(false)
    dispatch({ type: 'new' })
    setCopied(false)
  }, [])

  return (
    <div className={styles.app}>
      <div className={styles.stage} data-growing={String(growing)} data-phase={phase}>
        <Accents on={phase === 'select'} />

        <Window className={styles.cardC} />
        <Window className={styles.cardB} />
        <Window className={styles.cardA}>
          {view === 'result' ? null : <Skeleton />}
          {phase === 'scanning' && !growing ? (
            <span aria-hidden="true" className={styles.scanner} />
          ) : null}
          {view === 'result' ? (
            <CodeWindow
              copied={copied}
              headingRef={headingRef}
              markdown={markdown}
              onCopy={handleCopy}
              onDownload={function () {
                triggerDownload(markdown)
              }}
              onNew={reset}
            />
          ) : null}
        </Window>

        <Overlay extra={styles.overlaySelect} on={phase === 'select'}>
          <h1
            className={styles.labelTitle}
            ref={phase === 'select' ? (headingRef as RefObject<HTMLHeadingElement>) : undefined}
            tabIndex={-1}
          >
            Select one or more screens
          </h1>
          <p className={styles.labelSub}>
            {selection.ignoredCount > 0
              ? ignoredNote(selection.ignoredCount)
              : 'Frames, components, instances or sections'}
          </p>
        </Overlay>

        <Overlay extra={styles.overlaySettings} on={phase === 'settings'}>
          <h1
            className={styles.settingsSummary}
            ref={
              phase === 'settings' ? (headingRef as RefObject<HTMLHeadingElement>) : undefined
            }
            tabIndex={-1}
          >
            {selectionTitle(selection)}
          </h1>
          <p className={styles.settingsNote}>{selectionNote(selection)}</p>
          <div className={styles.settingsPanel}>
            <SettingsRow
              hint={colorHint(view, selection, colorModeChosen)}
              label="Color output"
              neutralValue="Off"
              onChange={chooseColorMode}
              options={colorOptions}
              tone={styles.segmentButtonOnBlue}
              value={colorMode}
            />
            <SettingsRow
              hint="Levels of nested component detail."
              label="Component depth"
              onChange={setComponentDepth}
              options={componentDepthOptions}
              tone={styles.segmentButtonOnOrange}
              value={componentDepth}
              wideFirst
            />
          </div>
          <button
            className={styles.startButton}
            disabled={selection.frames.length === 0}
            onClick={handleGenerate}
            type="button"
          >
            {view === 'error' ? 'Retry Scan' : 'Start Scan'}
          </button>
        </Overlay>

        <Overlay extra={styles.overlayScanning} on={phase === 'scanning' && !growing}>
          <h1
            className={styles.labelTitle + ' ' + styles.labelTitleRunning}
            ref={
              phase === 'scanning' ? (headingRef as RefObject<HTMLHeadingElement>) : undefined
            }
            tabIndex={-1}
          >
            Compacting Screen specifications
          </h1>
          <p className={styles.labelSub}>Hold on tight!</p>
        </Overlay>

        {view === 'error' ? <ErrorBanner message={error} /> : null}

        <span aria-live="polite" className={styles.liveRegion}>
          {liveMessage(view, progress, screens, markdown, copied)}
        </span>
      </div>

      <textarea
        aria-hidden="true"
        className={styles.copyArea}
        readOnly
        ref={copyAreaRef}
        tabIndex={-1}
        value={getMarkdownExport(markdown)}
      />
    </div>
  )
}

function Overlay({
  children,
  extra,
  on: isOn
}: {
  children: preact.ComponentChildren
  extra: string
  on: boolean
}) {
  return (
    <div
      aria-hidden={!isOn}
      className={styles.overlay + ' ' + extra + (isOn ? ' ' + styles.overlayOn : '')}
    >
      {children}
    </div>
  )
}

function Window({
  children,
  className
}: {
  children?: preact.ComponentChildren
  className: string
}) {
  return (
    <div className={styles.card + ' ' + className}>
      <span aria-hidden="true" className={styles.cardBar}>
        <span className={styles.cardDot} />
        <span className={styles.cardDot} />
        <span className={styles.cardDot} />
      </span>
      {children}
      <span aria-hidden="true" className={styles.cardBorder} />
    </div>
  )
}

function Skeleton() {
  return (
    <span aria-hidden="true" className={styles.skeleton}>
      <span className={styles.skeletonRail} />
      <span className={styles.skeletonBody}>
        <span className={styles.skeletonBar} />
        <span className={styles.skeletonBar} />
        <span className={styles.skeletonBar} />
        <span className={styles.skeletonBar} />
        <span className={styles.skeletonBar} />
      </span>
    </span>
  )
}

// Nested rings rather than one: a single radius would read as a carousel. Sizes
// and speeds are deliberately uneven so the field never lines back up, and the
// widest ellipse still clears the labels below the cards.
// One ring, one radius, one size, one period: nine glyphs spaced a ninth of a
// turn apart, so the gap between neighbours never changes. Only the glyph
// differs — the geometry is identical for all of them.
const ORBIT_RADIUS = 155
const ORBIT_SIZE = 18
const ORBIT_PERIOD = 34

const ORBIT_ICONS: Array<string> = [
  fitAccent,
  cursorAccent,
  screenshotAccent,
  terminalAccent,
  copyIcon,
  terminalVioletAccent,
  screenshotAmberAccent,
  copyScanAccent,
  fitBlueAccent
]

function Accents({ on: isOn }: { on: boolean }) {
  const step = 360 / ORBIT_ICONS.length
  return (
    <div
      aria-hidden="true"
      className={styles.orbitField + (isOn ? ' ' + styles.orbitFieldOn : '')}
    >
      {ORBIT_ICONS.map(function (src, index) {
        const angle = index * step
        return (
          <span
            className={styles.orbit}
            key={src}
            style={{
              '--dur': ORBIT_PERIOD + 's',
              // A negative delay starts the ring already that far around, which
              // is what spaces the glyphs instead of launching them together.
              '--phase': (-(angle / 360) * ORBIT_PERIOD).toFixed(2) + 's',
              '--r': ORBIT_RADIUS + 'px',
              '--size': ORBIT_SIZE + 'px',
              '--angle': angle + 'deg'
            }}
          >
            <span className={styles.orbitArm}>
              <img alt="" className={styles.orbitIcon} src={src} />
            </span>
          </span>
        )
      })}
    </div>
  )
}

function SettingsRow({
  hint,
  label,
  onChange,
  neutralValue,
  options,
  tone,
  value,
  wideFirst
}: {
  hint: string
  label: string
  neutralValue?: string
  onChange: (value: string) => void
  options: Array<string>
  tone: string
  value: string
  wideFirst?: boolean
}) {
  const name = label.replace(/\s+/g, '-').toLowerCase()
  return (
    <div aria-label={label} className={styles.settingsRow} role="radiogroup">
      <div className={styles.settingsText}>
        <span className={styles.settingsLabel}>{label}</span>
        <span className={styles.settingsHint}>{hint}</span>
      </div>
      <div className={styles.segment}>
        {options.map(function (option, index) {
          const selected = option === value
          return (
            <button
              aria-checked={selected}
              className={
                styles.segmentButton +
                (wideFirst === true && index === 0 ? ' ' + styles.segmentButtonWide : '') +
                (selected
                  ? ' ' + (option === neutralValue ? styles.segmentButtonOnNeutral : tone)
                  : '')
              }
              key={name + '-' + option}
              onClick={function () {
                onChange(option)
              }}
              role="radio"
              type="button"
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CodeWindow({
  copied,
  headingRef,
  markdown,
  onCopy,
  onDownload,
  onNew
}: {
  copied: boolean
  headingRef: RefObject<HTMLElement>
  markdown: string
  onCopy: () => void
  onDownload: () => void
  onNew: () => void
}) {
  const { lines, done } = useTypewriter(markdown)
  return (
    <div className={styles.codeBody}>
      <div className={styles.codeHeader}>
        <div className={styles.codeTitle}>
          <img alt="" className={styles.codeTitleIcon} src={terminalIcon} />
          <h1
            className={styles.codeTitleText}
            ref={headingRef as RefObject<HTMLHeadingElement>}
            tabIndex={-1}
          >
            screens.md
          </h1>
        </div>
        <div className={styles.codeActions}>
          <button
            aria-label="Start a new extraction"
            className={styles.iconButton + ' ' + styles.iconButtonSpin}
            onClick={onNew}
            title="New extraction"
            type="button"
          >
            <IconRefresh16 />
          </button>
          <button
            aria-label="Download screens.md"
            className={styles.iconButton + ' ' + styles.iconButtonWide}
            onClick={onDownload}
            title="Download screens.md"
            type="button"
          >
            <IconExportSmall24 />
          </button>
          <button
            className={styles.copyButton + (copied ? ' ' + styles.copyButtonDone : '')}
            onClick={onCopy}
            type="button"
          >
            {copied ? (
              <span className={styles.copyCheck}>
                <IconCheck16 />
              </span>
            ) : (
              <img alt="" className={styles.copyIcon} src={copyIcon} />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div
        aria-label="Generated Markdown"
        className={styles.codeSurface + (done ? ' ' + styles.codeSurfaceDone : '')}
        tabIndex={0}
      >
        <div className={styles.codeLines}>
          {lines.map(function (line, index) {
            return (
              <code className={styles.codeLine + ' ' + codeTone(line)} key={index}>
                {line || ' '}
                {!done && index === lines.length - 1 ? (
                  <i aria-hidden="true" className={styles.caret} />
                ) : null}
              </code>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Roughly the prototype's 8ms per character, but the real payload is a whole
// spec rather than thirteen mocked lines, so the run is capped: a long file
// types faster instead of making the plugin wait on an animation.
const MS_PER_CHAR = 8
const MAX_TYPING_MS = 2800

function useTypewriter(text: string): { lines: Array<string>; done: boolean } {
  const allLines = useMemo(
    function () {
      return text.split('\n')
    },
    [text]
  )
  // Index of the first character of each line, plus a terminating total, so a
  // frame only has to slice the one line the cursor is inside.
  const offsets = useMemo(
    function () {
      const result: Array<number> = []
      let at = 0
      for (const line of allLines) {
        result.push(at)
        at += line.length + 1
      }
      result.push(at)
      return result
    },
    [allLines]
  )

  const instant = text.length === 0 || prefersReducedMotion()
  const [revealed, setRevealed] = useState(instant ? text.length : 0)

  useEffect(
    function () {
      if (instant) {
        setRevealed(text.length)
        return
      }
      setRevealed(0)
      const total = text.length
      const duration = Math.min(MAX_TYPING_MS, total * MS_PER_CHAR)
      const started = performance.now()
      let frame = 0
      const step = function (now: number) {
        const ratio = Math.min(1, (now - started) / duration)
        setRevealed(Math.floor(ratio * total))
        if (ratio < 1) {
          frame = requestAnimationFrame(step)
        } else {
          setRevealed(total)
        }
      }
      frame = requestAnimationFrame(step)
      return function () {
        cancelAnimationFrame(frame)
      }
    },
    [instant, text]
  )

  const done = revealed >= text.length
  const lines = useMemo(
    function () {
      if (done) {
        return allLines
      }
      let low = 0
      let high = allLines.length - 1
      while (low < high) {
        const mid = (low + high + 1) >> 1
        if (offsets[mid] <= revealed) {
          low = mid
        } else {
          high = mid - 1
        }
      }
      return allLines.slice(0, low).concat(allLines[low].slice(0, revealed - offsets[low]))
    },
    [allLines, done, offsets, revealed]
  )

  return { lines, done }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className={styles.errorBanner} role="alert">
      <span aria-hidden="true" className={styles.errorBannerIcon}>
        <IconWarningSmall24 />
      </span>
      <div>
        <strong>Extraction stopped</strong>
        <span>{message}</span>
      </div>
    </div>
  )
}

// The Color output default is set from the selection rather than by the user,
// so the hint is where that gets said out loud — otherwise "Tokens" would just
// appear pre-selected with no explanation.
function colorHint(
  view: UiViewState,
  selection: SelectionSummary,
  chosen: boolean
): string {
  if (view === 'error') {
    return 'Your settings are unchanged.'
  }
  if (!chosen && selection.hasColorTokens) {
    return 'Token names found in this selection.'
  }
  if (!chosen && selection.frames.length > 0) {
    return 'No bound colour tokens found here.'
  }
  return 'Token names, with hex fallback.'
}

function selectionTitle(selection: SelectionSummary): string {
  if (selection.frames.length === 0) {
    return 'Nothing selected'
  }
  return selection.frames.length === 1
    ? selection.frames[0].name
    : selection.frames.length + ' screens selected'
}

function selectionNote(selection: SelectionSummary): string {
  const notes: Array<string> = []
  if (selection.frames.length > 1) {
    notes.push(
      selection.frames
        .slice(0, 2)
        .map(function (frame) {
          return frame.name
        })
        .join(' · ') + (selection.frames.length > 2 ? ' +' + (selection.frames.length - 2) : '')
    )
  } else if (selection.frames.length === 1) {
    const frame = selection.frames[0]
    notes.push(Math.round(frame.width) + '×' + Math.round(frame.height))
  }
  if (selection.ignoredCount > 0) {
    notes.push(ignoredNote(selection.ignoredCount))
  }
  return notes.join(' · ')
}

function ignoredNote(count: number): string {
  return count + ' unsupported ' + (count === 1 ? 'layer' : 'layers') + ' ignored'
}

function liveMessage(
  view: UiViewState,
  progress: ExtractionProgress | null,
  screens: Array<ScreenData>,
  markdown: string,
  copied: boolean
): string {
  if (copied) {
    return 'Markdown copied to the clipboard.'
  }
  if (view === 'extracting') {
    // The canvas shows "Hold on tight!", so the per-frame progress the designs
    // leave out is announced here rather than dropped.
    const current = progress?.current ?? 1
    const total = progress?.total ?? 1
    return (
      'Extracting screen ' +
      current +
      ' of ' +
      total +
      (progress?.frameName ? ' · ' + progress.frameName : '')
    )
  }
  if (view === 'result') {
    const items = screens.reduce(function (sum, screen) {
      return sum + screen.elements.length
    }, 0)
    return (
      'screens.md ready · ' +
      screens.length +
      (screens.length === 1 ? ' screen · ' : ' screens · ') +
      items +
      ' items · ' +
      formatBytes(markdown.length)
    )
  }
  return ''
}

function codeTone(line: string): string {
  if (line.startsWith('## ')) {
    return styles.codeKeyword
  }
  // `>` is the interpretation guide: prose about the spec, not the spec itself.
  if (line.startsWith('#') || line.startsWith('>') || line.charCodeAt(0) === 96) {
    return styles.codeComment
  }
  if (/^\s*(screen|items|\d+):/.test(line)) {
    return styles.codeKey
  }
  return styles.codeText
}

function formatBytes(characters: number): string {
  return characters < 1000
    ? String(characters) + ' B'
    : (characters / 1000).toFixed(1) + ' KB'
}

function triggerDownload(markdown: string): void {
  const blob = createMarkdownBlob(markdown)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'screens.md'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default render(Plugin)
