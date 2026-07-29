$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$temporaryConfig = Join-Path $repoRoot "wrangler.toml"
$pagesConfig = Join-Path $PSScriptRoot "wrangler.pages.toml"

if (Test-Path -LiteralPath $temporaryConfig) {
  throw "Refusing to overwrite an existing root wrangler.toml file."
}

Copy-Item -LiteralPath $pagesConfig -Destination $temporaryConfig
try {
  Push-Location $repoRoot
  try {
    npx wrangler pages deploy . `
      --project-name tobacco-road-games-staging `
      --commit-dirty=true
    if ($LASTEXITCODE -ne 0) {
      throw "Staging deployment failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
} finally {
  if (Test-Path -LiteralPath $temporaryConfig) {
    Remove-Item -LiteralPath $temporaryConfig -Force
  }
}
