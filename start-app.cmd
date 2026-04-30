@echo off
set NODE_PATH=C:\Users\John\AppData\Local\OpenAI\Codex\bin\node.exe

if not exist "%NODE_PATH%" (
  echo Node was not found at %NODE_PATH%
  exit /b 1
)

"%NODE_PATH%" "%~dp0server.js"
