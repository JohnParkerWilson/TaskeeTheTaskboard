$nodePath = "C:\Users\John\AppData\Local\OpenAI\Codex\bin\node.exe"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path $nodePath)) {
  Write-Error "Node was not found at $nodePath"
  exit 1
}

Set-Location $projectRoot
& $nodePath "server.js"
