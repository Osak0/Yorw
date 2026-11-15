"""Versioned model profiles and bounded, cancellable capability checks."""
import json
from datetime import datetime, timezone
from threading import Event, Lock, Thread
from uuid import UUID, uuid4
from typing import Literal
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .providers import ProviderConfig, ProbeError, probe
from .model_transport import tool_probe


class ProfileInput(ProviderConfig):
    name: str = Field(min_length=1,max_length=100)
    provider: Literal['deepseek','kimi','glm','qwen','compatible'] = 'compatible'


class DefaultsInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    research_id: UUID | None
    memory_id: UUID | None
    version: int = Field(ge=1,strict=True)


def router(database):
    routes = APIRouter(prefix='/profiles')
    jobs, lock = {}, Lock()
    fields = 'id,name,provider,base_url,model,version,legacy_version,chat_check,tools_check,updated_at'

    def profiles():
        with database.lock:
            rows = database.connection.execute('SELECT '+fields+' FROM model_profiles ORDER BY name,id').fetchall()
        return [dict(zip(fields.split(','),row)) for row in rows]

    def get(identity):
        item = next((p for p in profiles() if p['id']==str(identity)),None)
        if not item:
            raise HTTPException(404,detail='PROFILE_NOT_FOUND')
        return item

    def defaults():
        with database.lock:
            row = database.connection.execute('SELECT research_id,memory_id,version FROM model_defaults WHERE singleton=1').fetchone()
        return dict(zip(('research_id','memory_id','version'),row))

    @routes.get('')
    def listing():
        return {'items':profiles(),'defaults':defaults()}

    @routes.put('/defaults')
    def save_defaults(value:DefaultsInput):
        with database.write() as conn:
            if defaults()['version'] != value.version:
                raise HTTPException(409,detail='CONFIG_CONFLICT')
            for identity in (value.research_id,value.memory_id):
                if identity is not None:
                    get(identity)
            conn.execute('UPDATE model_defaults SET research_id=?,memory_id=?,version=version+1 WHERE singleton=1',
                         (str(value.research_id) if value.research_id else None,str(value.memory_id) if value.memory_id else None))
        return defaults()

    @routes.put('/{identity}')
    def save(identity:UUID,value:ProfileInput):
        with database.write() as conn:
            old = next((p for p in profiles() if p['id']==str(identity)),None)
            if (old['version'] if old else 0) != value.version:
                raise HTTPException(409,detail='CONFIG_CONFLICT')
            conn.execute('INSERT INTO model_profiles(id,name,provider,base_url,model,version,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,base_url=excluded.base_url,model=excluded.model,version=excluded.version,legacy_version=NULL,chat_check=NULL,tools_check=NULL,updated_at=excluded.updated_at',
                (str(identity),value.name,value.provider,value.base_url,value.model,value.version+1,datetime.now(timezone.utc).isoformat()))
        return get(identity)

    @routes.delete('/{identity}')
    def remove(identity:UUID,version:int):
        with database.write() as conn:
            if get(identity)['version'] != version:
                raise HTTPException(409,detail='CONFIG_CONFLICT')
            conn.execute('UPDATE model_defaults SET research_id=CASE WHEN research_id=? THEN NULL ELSE research_id END,memory_id=CASE WHEN memory_id=? THEN NULL ELSE memory_id END,version=version+1 WHERE singleton=1',(str(identity),str(identity)))
            conn.execute('DELETE FROM model_profiles WHERE id=?',(str(identity),))
        return {'removed':True}

    @routes.post('/{identity}/checks/{kind}')
    def start(identity:UUID,kind:Literal['chat','tools'],x_provider_key:str=Header(default='')):
        config = get(identity)
        if not x_provider_key:
            raise HTTPException(422,detail='KEY_MISSING')
        with lock:
            if any(j.get('active',False) for j in jobs.values()):
                raise HTTPException(409,detail='CHECK_BUSY')
            # Retain only a bounded diagnostic window. No keys or model bodies.
            while len(jobs)>=32:
                jobs.pop(next(iter(jobs)))
            job_id = str(uuid4())
            stop = Event()
            job = {'id':job_id,'profile_id':str(identity),'version':config['version'],'kind':kind,'status':'running','result':None,'stop':stop,'active':True}
            jobs[job_id]=job
        def check_current():
            if get(identity)['version'] != config['version']:
                raise ProbeError('CONFIG_CONFLICT')
        def run():
            try:
                result = tool_probe(config,x_provider_key,stop,check_current=check_current) if kind=='tools' else probe('chat',config,x_provider_key)
                if stop.is_set():
                    raise ProbeError('CANCELLED')
                with lock, database.write() as conn:
                    if stop.is_set():
                        raise ProbeError('CANCELLED')
                    if get(identity)['version'] != config['version']:
                        raise ProbeError('CONFIG_CONFLICT')
                    conn.execute('UPDATE model_profiles SET '+('tools_check' if kind=='tools' else 'chat_check')+'=? WHERE id=?',
                        (json.dumps({**result,'tested_at':datetime.now(timezone.utc).isoformat()}),str(identity)))
                    job.update(status='completed',result=result)
            except (ProbeError,HTTPException) as error:
                code = error.code if isinstance(error,ProbeError) else 'CONFIG_CONFLICT'
                with lock:
                    if not stop.is_set():
                        job.update(status='failed',result={'ok':False,'code':code})
                if not stop.is_set():
                    with database.write() as conn:
                        conn.execute('UPDATE model_profiles SET '+('tools_check' if kind=='tools' else 'chat_check')+'=? WHERE id=? AND version=?',
                          (json.dumps({'ok':False,'code':code,'tested_at':datetime.now(timezone.utc).isoformat()}),str(identity),config['version']))
            except Exception:
                with lock:
                    if not stop.is_set():
                        job.update(status='failed',result={'ok':False,'code':'CHECK_FAILED'})
            finally:
                with lock:
                    job['active']=False
        Thread(target=run,daemon=True).start()
        return {'id':job_id,'status':'running'}

    @routes.get('/checks/{job_id}')
    def view(job_id:UUID):
        with lock:
            job=jobs.get(str(job_id))
            if not job:
                raise HTTPException(404,detail='CHECK_NOT_FOUND')
            return {k:v for k,v in job.items() if k not in ('stop','active')}

    @routes.post('/checks/{job_id}/cancel')
    def cancel(job_id:UUID):
        with lock:
            job=jobs.get(str(job_id))
            if not job:
                raise HTTPException(404,detail='CHECK_NOT_FOUND')
            if job['status']=='running':
                job['stop'].set()
                job.update(status='cancelled',result={'ok':False,'code':'CANCELLED'})
        return {'cancelled':True}
    return routes
