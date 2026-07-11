import {
  Button,
  IconCheck16,
  IconClipboardSmall24,
  IconExportSmall24,
  IconFrame16,
  IconRefresh16,
  IconSection16,
  IconWarningSmall24,
  SegmentedControl,
  SegmentedControlOption,
  render
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { ComponentChildren, h, RefObject } from 'preact'
import { useCallback, useEffect, useReducer, useRef, useState } from 'preact/hooks'

import extractingIllustration from '../assets/illustration-extract-markdown.png'
import selectIllustration from '../assets/illustration-select-frame.png'
import { createMarkdownBlob, getMarkdownExport } from './lib/export'
import { buildMarkdown } from './lib/outline'
import { getUiSize, initialUiModel, reduceUiModel } from './lib/ui-state'
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

const colorOptions: Array<SegmentedControlOption> = [
  { value: 'Off' },
  { value: 'Tokens' },
  { value: 'Hex' }
]
function Plugin() {
  const [model, dispatch] = useReducer(reduceUiModel, initialUiModel)
  const [copied, setCopied] = useState(false)
  const [colorMode, setColorMode] = useState<string>('Off')
  const copyAreaRef = useRef<HTMLTextAreaElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { error, markdown, progress, screens, selection, view } = model

  useEffect(function () {
    const removeSelection = on<SelectionHandler>('SELECTION', function (nextSelection) {
      dispatch({ type: 'selection', selection: nextSelection })
    })
    const removeProgress = on<ProgressHandler>('PROGRESS', function (nextProgress) {
      dispatch({ type: 'progress', progress: nextProgress })
    })
    const removeScreens = on<ScreensHandler>('SCREENS', function (nextScreens) {
      const md = buildMarkdown(nextScreens)
      dispatch({ type: 'success', screens: nextScreens, markdown: md })
      setCopied(false)
    })
    const removeError = on<ErrorHandler>('ERROR', function (message) {
      dispatch({ type: 'failure', message })
    })
    emit<UiReadyHandler>('UI_READY')
    return function () {
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
    [selection.frames.length, selection.ignoredCount, view]
  )

  const handleGenerate = useCallback(
    function () {
      if (selection.frames.length === 0) {
        return
      }
      setCopied(false)
      dispatch({ type: 'start' })
      emit<GenerateHandler>('GENERATE', colorMode.toLowerCase() as ColorMode)
    },
    [colorMode, selection]
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
    dispatch({ type: 'new' })
    setCopied(false)
  }, [])

  return (
    <div className={styles.app}>
      <main className={styles.main}>
        {view === 'empty' ? (
          <EmptyState headingRef={headingRef} ignoredCount={selection.ignoredCount} />
        ) : null}
        {view === 'ready' ? (
          <ReadyState
            colorMode={colorMode}
            headingRef={headingRef}
            onColorModeChange={setColorMode}
            onGenerate={handleGenerate}
            selection={selection}
          />
        ) : null}
        {view === 'extracting' ? (
          <ExtractingState headingRef={headingRef} progress={progress} />
        ) : null}
        {view === 'result' ? (
          <ResultState
            copied={copied}
            headingRef={headingRef}
            markdown={markdown}
            onCopy={handleCopy}
            onDownload={function () {
              triggerDownload(markdown)
            }}
            onNew={reset}
            screens={screens}
          />
        ) : null}
        {view === 'error' ? (
          <ErrorState
            colorMode={colorMode}
            headingRef={headingRef}
            message={error}
            onColorModeChange={setColorMode}
            onRetry={handleGenerate}
            selection={selection}
          />
        ) : null}
      </main>
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

function EmptyState({
  headingRef,
  ignoredCount
}: {
  headingRef: RefObject<HTMLHeadingElement>
  ignoredCount: number
}) {
  return (
    <section className={styles.centeredState}>
      <Illustration src={selectIllustration} />
      <StateTitle headingRef={headingRef}>Select a frame or section</StateTitle>
      <p className={styles.stateBody}>
        Choose one or more screen-sized frames or sections on the canvas. Your selection appears
        here automatically.
      </p>
      {ignoredCount > 0 ? (
        <p aria-live="polite" className={styles.quietNote}>
          {ignoredCount +
            ' unsupported ' +
            (ignoredCount === 1 ? 'layer is' : 'layers are') +
            ' selected.'}
        </p>
      ) : null}
    </section>
  )
}

function ReadyState({
  colorMode,
  headingRef,
  onColorModeChange,
  onGenerate,
  selection
}: {
  colorMode: string
  headingRef: RefObject<HTMLHeadingElement>
  onColorModeChange: (value: string) => void
  onGenerate: () => void
  selection: SelectionSummary
}) {
  const title =
    selection.frames.length === 1
      ? selection.frames[0].name
      : String(selection.frames.length) + ' screens selected'
  return (
    <section className={styles.readyState}>
      <div>
        <p className={styles.stateKicker}>Selection</p>
        <StateTitle headingRef={headingRef} left>
          Ready to export
        </StateTitle>
        <p className={styles.selectionSummary}>{title}</p>
      </div>
      <SelectionCard selection={selection} />
      <div className={styles.optionGroup}>
        <div className={styles.optionHeading}>
          <span className={styles.optionLabel}>Color output</span>
          <span className={styles.optionHint}>Use names when your design uses tokens.</span>
        </div>
        <SegmentedControl
          options={colorOptions}
          value={colorMode}
          onValueChange={onColorModeChange}
        />
      </div>
      <Button className={styles.primaryButton} fullWidth onClick={onGenerate}>
        Create screens.md
      </Button>
    </section>
  )
}

function SelectionCard({ selection }: { selection: SelectionSummary }) {
  return (
    <div aria-live="polite" className={styles.selectionList}>
        {selection.frames.slice(0, 3).map((frame) => (
          <div className={styles.selectionRow} key={frame.id}>
            <span aria-hidden="true" className={styles.selectionIcon}>
              {frame.type === 'FRAME' ? <IconFrame16 /> : <IconSection16 />}
            </span>
            <span className={styles.selectionName}>{frame.name}</span>
            <span className={styles.selectionSize}>
              {Math.round(frame.width) + '×' + Math.round(frame.height)}
            </span>
          </div>
        ))}
        {selection.frames.length > 3 ? (
          <div className={styles.moreFrames}>+{selection.frames.length - 3} more</div>
        ) : null}
      {selection.ignoredCount > 0 ? (
        <div className={styles.ignoredNote}>
          {selection.ignoredCount +
            ' unsupported ' +
            (selection.ignoredCount === 1 ? 'layer' : 'layers') +
            ' ignored'}
        </div>
      ) : null}
    </div>
  )
}

function ExtractingState({
  headingRef,
  progress
}: {
  headingRef: RefObject<HTMLHeadingElement>
  progress: ExtractionProgress | null
}) {
  const current = progress?.current ?? 1
  const total = progress?.total ?? 1
  const percent = Math.max(8, Math.min(100, Math.round((current / total) * 100)))
  const text =
    'Extracting frame ' +
    current +
    ' of ' +
    total +
    (progress?.frameName ? ' · ' + progress.frameName : '')
  return (
    <section className={styles.centeredState}>
      <Illustration extracting src={extractingIllustration} />
      <StateTitle headingRef={headingRef}>Building screens.md</StateTitle>
      <p aria-live="polite" className={styles.stateBody}>
        {text}
      </p>
      <div
        aria-label={'Extraction progress: ' + percent + '%'}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className={styles.progressTrack}
        role="progressbar"
      >
        <span className={styles.progressFill} style={{ width: percent + '%' }} />
      </div>
    </section>
  )
}

function ResultState({
  copied,
  headingRef,
  markdown,
  onCopy,
  onDownload,
  onNew,
  screens
}: {
  copied: boolean
  headingRef: RefObject<HTMLHeadingElement>
  markdown: string
  onCopy: () => void
  onDownload: () => void
  onNew: () => void
  screens: Array<ScreenData>
}) {
  const itemCount = screens.reduce((sum, screen) => sum + screen.elements.length, 0)
  const stats =
    screens.length +
    ' ' +
    (screens.length === 1 ? 'screen' : 'screens') +
    ' · ' +
    itemCount +
    ' items · ' +
    formatBytes(markdown.length)
  return (
    <section className={styles.resultState}>
      <div className={styles.resultHeadingRow}>
        <div>
          <StateTitle headingRef={headingRef} left>
            screens.md
          </StateTitle>
          <p className={styles.resultMeta}>{stats}</p>
        </div>
        <button className={styles.newButton} onClick={onNew} type="button">
          <IconRefresh16 />
          New
        </button>
      </div>
      <div className={styles.fileWindow}>
        <CodePreview markdown={markdown} />
      </div>
      <div className={styles.actionRow}>
        <Button className={styles.primaryButton} fullWidth onClick={onCopy}>
          <span className={styles.buttonContent}>
            {copied ? <IconCheck16 /> : <IconClipboardSmall24 />}
            {copied ? 'Copied' : 'Copy Markdown'}
          </span>
        </Button>
        <Button className={styles.secondaryButton} fullWidth onClick={onDownload} secondary>
          <span className={styles.buttonContent}>
            <IconExportSmall24 />
            Download .md
          </span>
        </Button>
      </div>
      <span aria-live="polite" className={styles.liveRegion}>
        {copied ? 'Markdown copied to the clipboard.' : ''}
      </span>
    </section>
  )
}

function ErrorState({
  colorMode,
  headingRef,
  message,
  onColorModeChange,
  onRetry,
  selection
}: {
  colorMode: string
  headingRef: RefObject<HTMLHeadingElement>
  message: string
  onColorModeChange: (value: string) => void
  onRetry: () => void
  selection: SelectionSummary
}) {
  const title =
    selection.frames.length === 1
      ? selection.frames[0].name
      : selection.frames.length + ' screens selected'

  return (
    <section className={styles.readyState}>
      <div>
        <p className={styles.stateKicker}>Selection</p>
        <StateTitle headingRef={headingRef} left>
          Ready to export
        </StateTitle>
        <p className={styles.selectionSummary}>{title}</p>
      </div>
      <div className={styles.errorBanner} role="alert">
        <span aria-hidden="true" className={styles.errorBannerIcon}>
          <IconWarningSmall24 />
        </span>
        <div>
          <strong>Extraction stopped</strong>
          <span>{message}</span>
        </div>
      </div>
      <SelectionCard selection={selection} />
      <div className={styles.optionGroup}>
        <div className={styles.optionHeading}>
          <span className={styles.optionLabel}>Color output</span>
          <span className={styles.optionHint}>Your settings are unchanged.</span>
        </div>
        <SegmentedControl
          options={colorOptions}
          value={colorMode}
          onValueChange={onColorModeChange}
        />
      </div>
      <Button className={styles.primaryButton} fullWidth onClick={onRetry}>
        Retry extraction
      </Button>
    </section>
  )
}

function Illustration({ extracting, src }: { extracting?: boolean; src: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={styles.illustration + (extracting ? ' ' + styles.extractingIllustration : '')}
      src={src}
    />
  )
}

function StateTitle({
  children,
  headingRef,
  left
}: {
  children: ComponentChildren
  headingRef: RefObject<HTMLHeadingElement>
  left?: boolean
}) {
  return (
    <h1 className={left ? styles.stateTitleLeft : styles.stateTitle} ref={headingRef} tabIndex={-1}>
      {children}
    </h1>
  )
}

function CodePreview({ markdown }: { markdown: string }) {
  return (
    <div aria-label="Generated Markdown preview" className={styles.codePreview} tabIndex={0}>
      {markdown.split('\n').map((line, index) => (
        <div className={styles.codeLine} key={String(index) + '-' + line}>
          <span aria-hidden="true" className={styles.lineNumber}>
            {index + 1}
          </span>
          <code className={codeTone(line)}>{line || ' '}</code>
        </div>
      ))}
    </div>
  )
}

function codeTone(line: string): string {
  if (line.startsWith('## ')) {
    return styles.codeHeading
  }
  if (line.startsWith('#') || line.charCodeAt(0) === 96) {
    return styles.codeComment
  }
  if (/^\s*(screen|items|\d+):/.test(line)) {
    return styles.codeKey
  }
  return styles.codeText
}

function formatBytes(characters: number): string {
  return characters < 1000 ? String(characters) + ' B' : (characters / 1000).toFixed(1) + ' KB'
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
