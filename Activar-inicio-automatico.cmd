@echo off
setlocal DisableDelayedExpansion
set "OBS_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%OBS_NODE%" set "OBS_NODE=node"
"%OBS_NODE%" "%~dp0configure-local-server.mjs"
if errorlevel 1 pause
