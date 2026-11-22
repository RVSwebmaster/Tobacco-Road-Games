param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseId,
  [Parameter(Mandatory = $true)]
  [switch]$AllowProductionSmoke
)

$ErrorActionPreference = "Stop"
if (-not $AllowProductionSmoke) { throw "Production smoke requires explicit -AllowProductionSmoke authorization." }
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$releaseRoot = Join-Path $repoRoot ".wrangler\release-pipeline\$ReleaseId"
$manifest = Get-Content -LiteralPath (Join-Path $releaseRoot "manifest.json") -Raw | ConvertFrom-Json
$deployment = Get-Content -LiteralPath (Join-Path $releaseRoot "production-deployment.json") -Raw | ConvertFrom-Json
$sourceRoot = Join-Path $repoRoot $manifest.artifact.sourceRoot
$outputPath = Join-Path $releaseRoot "production-checks.json"
$baseUrl = (Get-Content -LiteralPath (Join-Path $repoRoot "ops\release\environments.json") -Raw | ConvertFrom-Json).production.publicOrigin

& node.exe (Join-Path $repoRoot "scripts\test-deployed-account-auth.mjs") `
  --target production `
  --allow-production `
  --base-url $baseUrl `
  --config (Join-Path $sourceRoot "wrangler.toml") `
  --config-cwd $sourceRoot `
  --wrangler-env production `
  --temp-dir (Join-Path $releaseRoot "production-smoke") `
  --commit-sha $manifest.commitSha `
  --manifest-sha256 $manifest.manifestSha256 `
  --output $outputPath
if ($LASTEXITCODE -ne 0) { throw "Production auth smoke failed or the controlled account cleanup was not verified." }
