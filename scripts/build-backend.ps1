$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$yorwMigrations = Join-Path $PWD "services/api/src/yorw_api/migrations"
& services/api/.venv/Scripts/python.exe -m PyInstaller --noconfirm --onedir --name yorw-api --paths services/api/src --add-data "${yorwMigrations}:yorw_api/migrations" --distpath services/api/dist --workpath services/api/build --specpath services/api/build services/api/src/entry.py
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
