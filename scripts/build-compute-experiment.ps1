param()
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$goCommand = Get-Command go -ErrorAction SilentlyContinue
if ($goCommand) {
    $goExe = $goCommand.Source
} else {
    $goExe = Join-Path (Split-Path $projectRoot -Parent) '.tools\go\bin\go.exe'
    if (-not (Test-Path -LiteralPath $goExe -PathType Leaf)) {
        throw 'Go is required to build the experimental companion.'
    }
}
$outputDir = Join-Path $projectRoot 'compute-experiment-package\windows-x64'
$outputExe = Join-Path $outputDir 'localfirst-compute-experiment.exe'
$previousCGO = $env:CGO_ENABLED
$previousGOOS = $env:GOOS
$previousGOARCH = $env:GOARCH
Push-Location -LiteralPath $projectRoot
try {
    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    & $goExe test -tags compute_experiment ./internal/computeexp/... ./cmd/localfirst-compute-experiment
    if ($LASTEXITCODE -ne 0) { throw 'Compute experiment tests failed; build stopped.' }
    [void](New-Item -ItemType Directory -Path $outputDir -Force)
    & $goExe build -trimpath -tags compute_experiment -o $outputExe ./cmd/localfirst-compute-experiment
    if ($LASTEXITCODE -ne 0) { throw 'Compute experiment build failed.' }
    Write-Host "Experimental companion built: $outputExe"
    Write-Host 'The running office app and its installer have not been changed.'
} finally {
    Pop-Location
    $env:CGO_ENABLED = $previousCGO
    $env:GOOS = $previousGOOS
    $env:GOARCH = $previousGOARCH
}
