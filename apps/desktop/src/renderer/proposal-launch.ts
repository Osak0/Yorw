/** Proposal tabs and result navigation; no model text becomes a trusted link. */
export const PROPOSAL_CHANGED = 'proposal-changed'

export function openProposal(id: string, title = '修改方案') {
  window.dispatchEvent(new CustomEvent('proposal-open', { detail: { id, title } }))
}

export function updateProposalTitle(id: string, title: string) {
  window.dispatchEvent(new CustomEvent('proposal-title', { detail: { id, title } }))
}

export function notifyProposal(id: string) {
  window.dispatchEvent(new CustomEvent(PROPOSAL_CHANGED, { detail: { id } }))
}

export function openProposalTopic(id: string, title = '专题') {
  window.dispatchEvent(new CustomEvent('proposal-topic-open', { detail: { id, title } }))
}

export function openProposalDocument(id: string) {
  window.dispatchEvent(new CustomEvent('proposal-document-open', { detail: { id } }))
}

export function openProposalNote(id: string) {
  window.dispatchEvent(new CustomEvent('proposal-note-open', { detail: { id } }))
}

export function openProposalReadingNote(documentId: string, noteId: string) {
  window.dispatchEvent(new CustomEvent('proposal-reading-note-open', { detail: { document_id: documentId, note_id: noteId } }))
}
