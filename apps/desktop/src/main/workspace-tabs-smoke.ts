import type { BrowserWindow } from 'electron'

/** Drives the real renderer through the stage-1 tab flow in an isolated smoke workspace. */
export async function runWorkspaceTabsSmoke(window: BrowserWindow): Promise<unknown> {
  return window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const end = Date.now() + 20000
      while (Date.now() < end) {
        if (predicate()) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('TABS_TIMEOUT_' + label)
    }
    const button = text => [...document.querySelectorAll('button')].find(element => element.textContent === text)
    const nav = name => [...document.querySelectorAll('.module-nav button')].find(element => element.textContent === name)
    const setInput = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const tabs = () => [...document.querySelectorAll('.workspace-tab')]

    button('检索').click()
    await waitFor(() => document.querySelector('input[aria-label="文献内检索"]'), 'SEARCH')
    const search = document.querySelector('input[aria-label="文献内检索"]')
    setInput(search, 'evidence')
    await new Promise(resolve => setTimeout(resolve, 100))
    if (search.value !== 'evidence') throw new Error('SEARCH_INPUT_NOT_ACCEPTED')

    nav('Garden').click()
    await waitFor(() => document.querySelector('.garden-content')?.textContent.includes('专题目录'), 'GARDEN_HOME')
    const name = document.querySelector('input[aria-label="新专题名称"]')
    setInput(name, 'Smoke topic')
    await waitFor(() => !button('创建专题').disabled, 'CREATE_ENABLED')
    button('创建专题').click()
    await waitFor(() => document.querySelector('.garden-editor h2')?.textContent.includes('Smoke topic'), 'TOPIC_OPEN')
    if (!tabs().some(tab => tab.textContent.includes('Smoke topic'))) throw new Error('TOPIC_TAB_MISSING')

    const documentTab = tabs().find(tab => tab.textContent.includes('Reader fixture'))
    const topicTab = tabs().find(tab => tab.textContent.includes('Smoke topic'))
    if (!documentTab || !topicTab) throw new Error('TAB_SET_INCOMPLETE')

    documentTab.click()
    await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'), 'DOCUMENT_BACK')
    const restoredSearch = document.querySelector('input[aria-label="文献内检索"]')?.value
    const restoredPage = document.querySelector('input[aria-label="物理页码"]')?.value
    const documentSelected = documentTab.getAttribute('aria-selected') === 'true'

    topicTab.click()
    await waitFor(() => document.querySelector('.garden-editor h2')?.textContent.includes('Smoke topic'), 'TOPIC_BACK')
    const topicSelected = topicTab.getAttribute('aria-selected') === 'true'
    const topicTitle = topicTab.textContent

    // Leave the reader visible for the existing layout screenshots.
    documentTab.click()
    await waitFor(() => document.querySelector('.reader-feedback')?.textContent.includes('已保存到第 2 页'), 'READER_RESTORED')

    return {
      tabCount: tabs().length,
      documentSelected,
      topicSelected,
      restoredSearch,
      restoredPage,
      moduleAfterDocumentTab: nav('Storage')?.getAttribute('aria-current'),
      topicTitle
    }
  })()`)
}
