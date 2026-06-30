import {
  Button,
  Columns,
  Container,
  render,
  SegmentedControl,
  SegmentedControlOption,
  Text,
  VerticalSpace
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { h } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import { buildMarkdown } from './lib/outline'
import {
  ColorMode,
  ErrorHandler,
  GenerateHandler,
  ScreenData,
  ScreensHandler
} from './types'

const colorOptions: Array<SegmentedControlOption> = [
  { value: 'Off' },
  { value: 'Tokens' },
  { value: 'Hex' }
]

function Plugin() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [copied, setCopied] = useState(false)
  const [colorMode, setColorMode] = useState<string>('Off')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(function () {
    const removeScreens = on<ScreensHandler>(
      'SCREENS',
      function (screens: Array<ScreenData>) {
        const md = buildMarkdown(screens)
        setMarkdown(md)
        setCopied(false)
        setBusy(false)
      }
    )
    const removeError = on<ErrorHandler>('ERROR', function (message: string) {
      setError(message)
      setBusy(false)
    })
    return function () {
      removeScreens()
      removeError()
    }
  }, [])

  const handleGenerate = useCallback(
    function () {
      setError('')
      setMarkdown('')
      setCopied(false)
      setBusy(true)
      emit<GenerateHandler>('GENERATE', colorMode.toLowerCase() as ColorMode)
    },
    [colorMode]
  )

  const handleCopy = useCallback(
    function () {
      const node = textareaRef.current
      if (node === null || markdown.length === 0) {
        return
      }
      node.focus()
      node.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        window.setTimeout(function () {
          setCopied(false)
        }, 1500)
      } catch {
        // Clipboard not available in this context — the textarea is still
        // selected so the user can copy manually.
      }
    },
    [markdown]
  )

  const handleDownload = useCallback(
    function () {
      if (markdown.length > 0) {
        triggerDownload(markdown)
      }
    },
    [markdown]
  )

  return (
    <Container
      space="medium"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
    >
      <VerticalSpace space="medium" />
      <Text>Colors</Text>
      <VerticalSpace space="extraSmall" />
      <SegmentedControl
        options={colorOptions}
        value={colorMode}
        onValueChange={setColorMode}
      />
      <VerticalSpace space="small" />
      <Button fullWidth loading={busy} onClick={handleGenerate}>
        Generate
      </Button>
      {error.length > 0 ? (
        <Text
          style={{
            color: 'var(--figma-color-text-danger)',
            marginTop: 'var(--space-small)'
          }}
        >
          {error}
        </Text>
      ) : null}
      <VerticalSpace space="small" />
      <textarea
        ref={textareaRef}
        readOnly
        value={markdown}
        placeholder="The generated Markdown will appear here…"
        style={{
          width: '100%',
          flex: '1 1 auto',
          minHeight: 0,
          boxSizing: 'border-box',
          resize: 'none',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: '11px',
          lineHeight: '1.4',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          overflow: 'auto',
          border: '1px solid var(--figma-color-border)',
          borderRadius: '4px',
          padding: '8px',
          background: 'var(--figma-color-bg)',
          color: 'var(--figma-color-text)'
        }}
      />
      <VerticalSpace space="small" />
      <Columns space="extraSmall">
        <Button fullWidth disabled={markdown.length === 0} onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          fullWidth
          disabled={markdown.length === 0}
          onClick={handleDownload}
          secondary
        >
          Download .md
        </Button>
      </Columns>
      <VerticalSpace space="medium" />
    </Container>
  )
}

function triggerDownload(markdown: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown' })
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
