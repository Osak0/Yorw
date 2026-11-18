import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,test} from 'vitest'
import {MoreActions,ContextHelp} from '../src/renderer/WorkspaceUI'

test('secondary actions stay in a named keyboard-native disclosure',()=>{
 const html=renderToStaticMarkup(<MoreActions label="会话操作"><button>归档</button><button>删除</button></MoreActions>)
 expect(html).toContain('<summary>会话操作</summary>');expect(html).toContain('归档');expect(html).toContain('删除');expect(html).not.toContain(' open=')
})
test('context explanation remains available without persistent prose or triangle controls',()=>{
 const html=renderToStaticMarkup(<ContextHelp label="专题关系说明"><p>普通关联不扩大笔记范围。</p></ContextHelp>)
 expect(html).toContain('<summary>专题关系说明</summary>');expect(html).toContain('普通关联不扩大笔记范围');expect(html).not.toMatch(/[▸▾▶▼]/)
})
