from uuid import uuid4
from test_library import library
from test_suggestions import service,setup
from test_ai_workflows import workflow,local,run,wait_draft
from test_notebooks import topic,create,write
from yorw_api.notebooks import Notebooks
from yorw_api.wiki_review import WikiReview,Accept
from yorw_api.source_status import source_status


def test_note_optimization_without_paper_keeps_user_snapshot_and_requires_acceptance(workflow,monkeypatch):
    _,owner,_=setup(workflow.suggestions)
    notebooks=Notebooks(workflow.library);note=create(notebooks,owner)
    saved=write(workflow.library,note,'User plan: compare two baselines, not an experiment result.')
    local(workflow)
    monkeypatch.setattr('yorw_api.suggestions.stream',lambda *a,**kw:iter(['Refined user plan, still pending experiment [S1].']))
    _,job=run(workflow,'draft',note['id'],'Organize this note',base=saved['revision']['id'],scope='topic',chat_key='owned-fixture',chat_version=1)
    assert job['status']=='succeeded',job
    suggestion=wait_draft(workflow,job)
    assert suggestion['status']=='completed',suggestion
    assert notebooks.get(note['id'])['body_md'].startswith('User plan:')
    assert suggestion['sources'][0]['kind']=='wiki' and suggestion['sources'][0]['notebook_snapshot']
    result=WikiReview(workflow.suggestions).decide(suggestion['id'],Accept(request_id=uuid4(),base_revision_id=saved['revision']['id'],body_md=suggestion['body_md']),True)
    assert result['view']['revision']['origin']=='ai_accepted'
    assert notebooks.get(note['id'])['body_md']==suggestion['body_md']
    assert source_status(workflow.db,result['view']['revision']['sources'])[0]['available']


def test_reading_note_ai_adoption_updates_original_note_and_preserves_versions(workflow,monkeypatch):
    from yorw_api.notes import NewNote
    from yorw_api.notebooks import Remove
    doc,_,_=setup(workflow.suggestions)
    reading=workflow.suggestions.notes.create(NewNote(id=uuid4(),document_id=doc,body_md='User reading plan, not a result.'))
    notebooks=Notebooks(workflow.library);head=notebooks.prepare_reading(reading['id'],Remove(version=reading['version']))
    local(workflow)
    monkeypatch.setattr('yorw_api.suggestions.stream',lambda *a,**kw:iter(['Refined reading note [S1].']))
    _,job=run(workflow,'draft',head['topic']['id'],'Organize',base=head['revision']['id'],scope='topic',chat_key='owned-fixture',chat_version=1)
    assert job['status']=='succeeded',job
    suggestion=wait_draft(workflow,job);assert suggestion['status']=='completed',suggestion
    assert suggestion['sources'][0]['kind']=='note'
    assert workflow.suggestions.notes._get(reading['id'])['version']==1
    value=Accept(request_id=uuid4(),base_revision_id=head['revision']['id'],body_md=suggestion['body_md'])
    review=WikiReview(workflow.suggestions);result=review.decide(suggestion['id'],value,True)
    saved=workflow.suggestions.notes._get(reading['id'])
    assert saved['version']==2 and saved['body_md']=='Refined reading note [S1].'
    assert saved['sources'][0]['available']
    assert len(workflow.library.rows('SELECT * FROM reading_note_revisions WHERE note_id=?',(reading['id'],)))==2
    review.decide(suggestion['id'],value,True)
    assert workflow.suggestions.notes._get(reading['id'])['version']==2


def test_reading_note_edit_during_ai_cannot_overwrite_newer_formal_note(workflow,monkeypatch):
    import pytest
    from fastapi import HTTPException
    from yorw_api.notes import NewNote,NoteBody
    from yorw_api.notebooks import Remove
    doc,_,_=setup(workflow.suggestions)
    reading=workflow.suggestions.notes.create(NewNote(id=uuid4(),document_id=doc,body_md='Original user note'))
    head=Notebooks(workflow.library).prepare_reading(reading['id'],Remove(version=1));local(workflow)
    monkeypatch.setattr('yorw_api.suggestions.stream',lambda *a,**kw:iter(['Candidate [S1].']))
    _,job=run(workflow,'draft',head['topic']['id'],'Organize',base=head['revision']['id'],scope='topic',chat_key='owned-fixture',chat_version=1)
    suggestion=wait_draft(workflow,job)
    workflow.suggestions.notes.update(reading['id'],NoteBody(version=1,body_md='Newer reading sidebar edit'))
    with pytest.raises(HTTPException):WikiReview(workflow.suggestions).decide(suggestion['id'],Accept(request_id=uuid4(),base_revision_id=head['revision']['id'],body_md=suggestion['body_md']),True)
    assert workflow.suggestions.notes._get(reading['id'])['body_md']=='Newer reading sidebar edit'
