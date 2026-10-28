$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
# Refuse to publish accidental changes to RV-approved storefront artwork.
& node.exe (Join-Path $repoRoot "scripts/test-storefront-visual-alignment.js")
if ($LASTEXITCODE -ne 0) { throw "Storefront visual protection failed; staging was not deployed." }

$temporaryConfig = Join-Path $repoRoot "wrangler.toml"
$pagesConfig = Join-Path $PSScriptRoot "wrangler.pages.toml"
$wranglerRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".wrangler"))
$deploymentRoot = [System.IO.Path]::GetFullPath((Join-Path $wranglerRoot "staging-pages-output"))
$deploymentRootCreated = $false

if (Test-Path -LiteralPath $temporaryConfig) {
  throw "Refusing to overwrite an existing root wrangler.toml file."
}
if (Test-Path -LiteralPath $deploymentRoot) {
  throw "Refusing to overwrite the existing staging deployment output directory: $deploymentRoot"
}

Copy-Item -LiteralPath $pagesConfig -Destination $temporaryConfig
try {
  & node.exe (Join-Path $repoRoot "scripts/build-pages-output.mjs") --output $deploymentRoot
  if ($LASTEXITCODE -ne 0) { throw "Staging Pages artifact build failed with exit code $LASTEXITCODE." }
  $deploymentRootCreated = $true

  if ((Test-Path -LiteralPath (Join-Path $deploymentRoot "tmp")) -or
      (Test-Path -LiteralPath (Join-Path $deploymentRoot "videos"))) {
    throw "Local work directories entered the staging deployment output."
  }
  foreach ($requiredPath in @("index.html", "store\index.html", "functions")) {
    $candidate = if ($requiredPath -eq "functions") {
      Join-Path $repoRoot $requiredPath
    } else {
      Join-Path $deploymentRoot $requiredPath
    }
    if (-not (Test-Path -LiteralPath $candidate)) {
      throw "Required staging deployment content is missing: $requiredPath"
    }
  }

  Push-Location $repoRoot
  try {
    npx wrangler pages deploy $deploymentRoot `
      --project-name tobacco-road-games-staging `
      --branch staging `
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
  if ($deploymentRootCreated -and (Test-Path -LiteralPath $deploymentRoot)) {
    $expectedParent = $wranglerRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
    $actualParent = [System.IO.Path]::GetDirectoryName($deploymentRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
    if ($actualParent -ne $expectedParent -or [System.IO.Path]::GetFileName($deploymentRoot) -ne "staging-pages-output") {
      throw "Refusing to remove an unexpected deployment output path: $deploymentRoot"
    }
    Remove-Item -LiteralPath $deploymentRoot -Recurse -Force
  }
}
