$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$temporaryConfig = Join-Path $repoRoot "wrangler.toml"
$pagesConfig = Join-Path $PSScriptRoot "wrangler.pages.toml"
$wranglerRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".wrangler"))
$deploymentRoot = [System.IO.Path]::GetFullPath((Join-Path $wranglerRoot "staging-pages-output"))
$publicRootFiles = @(
  "_routes.json",
  "404.html",
  "account.html",
  "ad-depot.html",
  "ai-policy.html",
  "authors.html",
  "index.html",
  "robots.txt",
  "sitemap.xml",
  "styles.css",
  "support.html"
)
$publicDirectories = @(
  "assets",
  "authors",
  "creator",
  "creators",
  "data",
  "launch-week",
  "media",
  "office",
  "owner",
  "shared",
  "store"
)
$excludedPublicFiles = @(
  "media\ads\README.md",
  "owner\downloads\README.md"
)
$deploymentRootCreated = $false

if (Test-Path -LiteralPath $temporaryConfig) {
  throw "Refusing to overwrite an existing root wrangler.toml file."
}
if (Test-Path -LiteralPath $deploymentRoot) {
  throw "Refusing to overwrite the existing staging deployment output directory: $deploymentRoot"
}

Copy-Item -LiteralPath $pagesConfig -Destination $temporaryConfig
try {
  New-Item -ItemType Directory -Path $deploymentRoot | Out-Null
  $deploymentRootCreated = $true

  foreach ($relativePath in $publicRootFiles) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $relativePath) -Destination $deploymentRoot
  }
  foreach ($relativePath in $publicDirectories) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $relativePath) -Destination $deploymentRoot -Recurse
  }
  foreach ($relativePath in $excludedPublicFiles) {
    $generatedPath = Join-Path $deploymentRoot $relativePath
    if (Test-Path -LiteralPath $generatedPath) {
      Remove-Item -LiteralPath $generatedPath -Force
    }
  }

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
