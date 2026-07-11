export function getMarkdownExport(markdown: string): string {
  return markdown
}

export function createMarkdownBlob(markdown: string): Blob {
  return new Blob([getMarkdownExport(markdown)], { type: 'text/markdown' })
}
