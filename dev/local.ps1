param(
    [ValidateSet('setup', 'check', 'browser', 'browser-deps', 'start', 'stop', 'status')]
    [string]$Action = 'check'
)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    # WSL inherits the current workspace, including uncommitted edits.
    if ($Action -eq 'browser-deps') {
        & wsl.exe -d Ubuntu -u root -- bash dev/local.sh $Action
    } else {
        & wsl.exe -d Ubuntu -- bash dev/local.sh $Action
    }
    if ($LASTEXITCODE -ne 0) { throw "Local $Action failed (exit $LASTEXITCODE)." }
} finally {
    Pop-Location
}
