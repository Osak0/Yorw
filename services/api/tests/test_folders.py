from uuid import UUID
import pytest
from fastapi import HTTPException
from yorw_api.folders import Folders,Change,Assignment
from test_library import library,pdf_bytes,wait
from io import BytesIO

def test_tree_conflicts_cycles_and_nonempty_delete(library):
    f=Folders(library)
    a=f.save(Change(name='资料'))['items'][0]
    f.save(Change(name='子目录',parent_id=a['id']))
    child=next(x for x in f.list()['items'] if x['parent_id'])
    with pytest.raises(HTTPException):f.save(Change(name='资料'))
    with pytest.raises(HTTPException):f.save(Change(name='资料',parent_id=child['id'],version=1),a['id'])
    with pytest.raises(HTTPException):f.save(Change(name='改名',version=99),a['id'])
    d=wait(library,library.import_pdf(BytesIO(pdf_bytes(True)),'fixture.pdf'))
    original=library.document(d['id'])
    f.assign(Assignment(folder_id=a['id'],documents={d['id']:original['version']}))
    current=library.document(d['id'])
    assert current['folder_id']==a['id']
    assert current['sha256']==original['sha256'] and current['extraction_version']==original['extraction_version']
    f.remove(a['id'],1)
    assert library.document(d['id'])['folder_id'] is None
    assert f.list()['items'][0]['parent_id'] is None

def test_assign_is_atomic_and_names_validated(library):
    f=Folders(library)
    for name in ['', 'x/y', 'a\\b', 'x'*101, '\n']:
        with pytest.raises(HTTPException):f.save(Change(name=name))
    d=wait(library,library.import_pdf(BytesIO(pdf_bytes(True)),'fixture.pdf'))
    a=f.save(Change(name='A'))['items'][0]
    with pytest.raises(HTTPException):f.assign(Assignment(folder_id=a['id'],documents={d['id']:d['version'],UUID(int=1):1}))
    assert library.document(d['id'])['folder_id'] is None

@pytest.mark.parametrize('frozen',[False,True])
def test_folder_http_and_original_path_are_id_scoped(frozen,tmp_path):
    from test_search_service import running
    from pathlib import Path
    import urllib.error
    with running(frozen,tmp_path/'workspace') as (request,upload):
        d=upload(pdf_bytes(True))
        original=request('/v1/documents/'+d)
        a=request('/v1/library-folders','POST',{'name':'研究'})['items'][0]
        request('/v1/library-folder-assignment','POST',{'folder_id':a['id'],'documents':{d:original['version']}})
        assert request('/v1/documents/'+d)['folder_id']==a['id']
        location=Path(request('/v1/library-original/'+d)['path'])
        assert location.is_file() and location.parent==(tmp_path/'workspace/documents').resolve()
        with pytest.raises(urllib.error.HTTPError):request('/v1/library-original/not-a-document')
        request('/v1/library-folders/'+a['id']+'?version=1','DELETE')
        assert request('/v1/documents/'+d)['folder_id'] is None
