$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$configPath = Join-Path $PSScriptRoot "wrangler.pages.toml"
$fixturePath = Join-Path $PSScriptRoot "sponsor-test-ads.sql"
$config = Get-Content -LiteralPath $configPath -Raw

if ($config -notmatch 'name\s*=\s*"tobacco-road-games-staging"' -or
    $config -notmatch 'database_name\s*=\s*"trg-orders-staging"') {
  throw "Refusing to load sponsor fixtures outside the isolated staging project/database."
}

Push-Location $repoRoot
try {
  npx wrangler d1 execute trg-orders-staging --remote --config $configPath --file $fixturePath
  if ($LASTEXITCODE -ne 0) {
    throw "Staging sponsor fixture load failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
