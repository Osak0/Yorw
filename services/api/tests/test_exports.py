from io import BytesIO
import json
from uuid import uuid4
from zipfile import ZipFile
import pytest
from fastapi import HTTPException
from yorw_api.exports import Exports,ExportSelection
from yorw_api.wiki_review import Accept,WikiReview
from yorw_api.garden import SaveBody
from yorw_api.notes import NewNote,NoteBody
from test_suggestions import service,setup,settle
from test_library import library


def test_export_exact_saved_text_sources_and_deleted_document_remain_exportable(service,monkeypatch):
    doc,topic,args=setup(service)
    monkeypatch.setattr('yorw_api.suggestions.stream',lambda *a,**k:iter(['中文 Fact [S1]']))
    item=settle(service,service.generate(topic,args,'private-key'))
    accepted=WikiReview(service).decide(item['id'],Accept(request_id=uuid4(),base_revision_id=args.base_revision_id,body_md=item['body_md']),True)['view']['revision']
    note=service.notes.create(NewNote(id=uuid4(),document_id=doc,body_md='# 原文\n\nUnicode 中文\n'))
    with service.db.write() as conn:conn.execute("UPDATE documents SET deleted_at='now' WHERE id=?",(doc,))
    exports=Exports(service.db)
    assert exports.catalog()['notes'][0]['document_available'] is False
    output=exports.create(ExportSelection(note_ids=[note['id']],topic_ids=[topic]))
    with ZipFile(BytesIO(exports.file(output['task_id']))) as archive:
        assert archive.read(f'notes/{note["id"]}.md')==note['body_md'].encode()
        assert archive.read(f'wiki/{topic}.md')==accepted['body_md'].encode()
        metadata=json.loads(archive.read(f'wiki/{topic}.md.sources.json'))
        assert metadata['id']==accepted['id'] and not metadata['sources'][0]['available']
        assert metadata['sources'][0]['evidence'][0]['quote']
        manifest=json.loads(archive.read('manifest.json'))
        assert manifest['format']=='yorw-content-export-v1' and len(manifest['items'])==2
        assert not any('..' in name or name.startswith('/') for name in archive.namelist())
        content=b'\n'.join(archive.read(name) for name in archive.namelist())
        assert b'private-key' not in content and b'provider_configs' not in content
    # File is a stable snapshot, not a live DB view.
    original=exports.file(output['task_id'])
    service.garden.save(topic,SaveBody(base_revision_id=accepted['id'],body_md='Changed'))
    assert exports.file(output['task_id'])==original


def test_invalid_selection_size_and_unavailable_files_do_not_claim_success(service,monkeypatch):
    doc,topic,_=setup(service);exports=Exports(service.db)
    for selection in [ExportSelection(),ExportSelection(topic_ids=[topic,topic]),ExportSelection(topic_ids=[uuid4()])]:
        with pytest.raises(HTTPException):exports.create(selection)
    assert service.db.connection.execute("SELECT count(*) FROM tasks WHERE kind='export'").fetchone()[0]==0
    monkeypatch.setattr('yorw_api.exports.MAX_CONTENT_BYTES',1)
    with pytest.raises(HTTPException) as error:exports.create(ExportSelection(topic_ids=[topic]))
    assert error.value.detail=='EXPORT_TOO_LARGE'
    assert not list((service.db.workspace.root/'tmp').glob('export-*'))
    with pytest.raises(HTTPException):exports.file(str(uuid4()))


def test_export_write_failure_leaves_no_successful_task_or_partial_archive(service,monkeypatch):
    from pathlib import Path
    _,topic,_=setup(service)
    original=Path.open
    def fail_export(path,*args,**kwargs):
        if path.name.startswith('export-'):raise OSError('fixture disk failure')
        return original(path,*args,**kwargs)
    monkeypatch.setattr(Path,'open',fail_export)
    with pytest.raises(OSError):Exports(service.db).create(ExportSelection(topic_ids=[topic]))
    assert service.db.connection.execute("SELECT count(*) FROM tasks WHERE kind='export'").fetchone()[0]==0
    assert not list((service.db.workspace.root/'tmp').glob('export-*'))
