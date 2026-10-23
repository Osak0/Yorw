$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& services/api/.venv/Scripts/python.exe -m PyInstaller --noconfirm --onedir --name yorw-api --paths services/api/src --distpath services/api/dist --workpath services/api/build --specpath services/api/build services/api/src/entry.py
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
