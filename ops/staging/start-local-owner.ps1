param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8788
)

$ErrorActionPreference = "Stop"
$canonicalRoot = "C:\Users\rvsaw\Desktop\Dr DM Workshop\Tobacco-Road-Games"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

if ($repositoryRoot -ne $canonicalRoot) {
  throw "Local Owner access may only run from the canonical Tobacco Road Games workspace."
}

$branch = (& git -C $repositoryRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne "staging") {
  throw "Local Owner access requires the staging branch. Current branch: $branch"
}

$template = Join-Path $repositoryRoot "ops\staging\wrangler.local-owner.toml"
$temporaryConfig = Join-Path $repositoryRoot "wrangler.toml"
$temporaryEnvironment = Join-Path $repositoryRoot ".dev.vars.owner-local"

foreach ($temporaryPath in @($temporaryConfig, $temporaryEnvironment)) {
  if (Test-Path -LiteralPath $temporaryPath) {
    throw "Refusing to overwrite existing local configuration: $temporaryPath"
  }
}

$randomBytes = New-Object byte[] 32
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()

try {
  $randomGenerator.GetBytes($randomBytes)
  $csrfSecret = [Convert]::ToBase64String($randomBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")

  Copy-Item -LiteralPath $template -Destination $temporaryConfig
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($temporaryEnvironment, "OWNER_CSRF_SECRET=$csrfSecret", $utf8WithoutBom)

  Write-Host "Starting the staging-resource Owner workbench on http://127.0.0.1:$Port/owner/"
  Write-Host "The server is loopback-only. Press Ctrl+C to stop it and remove temporary configuration."

  Push-Location $repositoryRoot
  try {
    & npx.cmd wrangler pages dev . --ip 127.0.0.1 --port $Port --env-file $temporaryEnvironment --show-interactive-dev-session=false
    if ($LASTEXITCODE -ne 0) {
      throw "Wrangler exited with code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
} finally {
  $randomGenerator.Dispose()
  if ($randomBytes) {
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
  }
  $csrfSecret = $null
  foreach ($temporaryPath in @($temporaryConfig, $temporaryEnvironment)) {
    $resolvedParent = (Resolve-Path (Split-Path -Parent $temporaryPath)).Path
    if ($resolvedParent -eq $canonicalRoot -and (Test-Path -LiteralPath $temporaryPath)) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}
