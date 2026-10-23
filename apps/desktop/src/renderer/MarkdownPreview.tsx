import React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MarkdownPreview({ body }: {body: string}) {
  // No raw HTML, fetched images, executable links or remote resources in notes.
  return <div className="markdown-preview" aria-label="Markdown 预览"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ children }) => <span className="preview-link">{children}</span>,
    img: ({ alt }) => <span>[图片：{alt || '未加载'}]</span>
  }}>{body || '*尚无笔记内容。*'}</Markdown></div>
}
