import React, { useEffect, useRef } from 'react'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
const externalUpdate=Annotation.define<boolean>()

export function MarkdownEditor({ value, onChange, onSave, label = 'Markdown 笔记正文' }: {value: string; onChange(value: string): void; onSave(): void; label?:string}) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onSave })
  callbacks.current = { onChange, onSave }
  useEffect(() => {
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: [
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true } }]),
      basicSetup, markdown(), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
      EditorView.updateListener.of(update => { if (update.docChanged&&!update.transactions.some(t=>t.annotation(externalUpdate))) callbacks.current.onChange(update.state.doc.toString()) }),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, "Microsoft YaHei", monospace', fontSize: '14px' }, '.cm-content': { minHeight: '240px' } })
    ] }) })
    editor.current = view
    return () => { editor.current = null; view.destroy() }
  }, [])
  useEffect(() => {
    const view = editor.current
    if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value },annotations:externalUpdate.of(true) })
  }, [value])
  return <div className="markdown-editor" ref={host} />
}
