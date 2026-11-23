param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseId
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$releaseRoot = Join-Path $repoRoot ".wrangler\release-pipeline\$ReleaseId"
$manifest = Get-Content -LiteralPath (Join-Path $releaseRoot "manifest.json") -Raw | ConvertFrom-Json
$deployment = Get-Content -LiteralPath (Join-Path $releaseRoot "staging-deployment.json") -Raw | ConvertFrom-Json
$sourceRoot = Join-Path $repoRoot $manifest.artifact.sourceRoot
$outputPath = Join-Path $releaseRoot "staging-checks.json"
$pipeline = Join-Path $repoRoot "scripts\release-pipeline.mjs"

& node.exe (Join-Path $repoRoot "scripts\test-deployed-account-auth.mjs") `
  --target staging `
  --base-url $deployment.deploymentUrl `
  --config (Join-Path $sourceRoot "wrangler.toml") `
  --config-cwd $sourceRoot `
  --wrangler-env production `
  --temp-dir (Join-Path $releaseRoot "staging-smoke") `
  --commit-sha $manifest.commitSha `
  --manifest-sha256 $manifest.manifestSha256 `
  --output $outputPath
if ($LASTEXITCODE -ne 0) { throw "Staging account journey failed or the controlled account cleanup was not verified." }

node.exe $pipeline record-staging-attestation `
  --release-id $ReleaseId `
  --deployment-id $deployment.deploymentId `
  --checks-file $outputPath
if ($LASTEXITCODE -ne 0) { throw "Staging verification did not match the deployed release." }
