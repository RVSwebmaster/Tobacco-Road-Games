param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("preview", "staging", "production")]
  [string]$Target,
  [Parameter(Mandatory = $true)]
  [string]$ReleaseId
)

$ErrorActionPreference = "Stop"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-JsonNoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value
  )
  $json = ConvertTo-Json -InputObject $Value -Depth 16
  [System.IO.File]::WriteAllText($Path, "$json`n", $utf8NoBom)
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$pipeline = Join-Path $repoRoot "scripts\release-pipeline.mjs"
$environmentMap = Get-Content -LiteralPath (Join-Path $repoRoot "ops\release\environments.json") -Raw | ConvertFrom-Json
$targetConfig = $environmentMap.$Target
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".wrangler\release-pipeline\$ReleaseId"))
$manifestPath = Join-Path $releaseRoot "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Release manifest not found: $manifestPath" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $manifest.artifact.sourceRoot))
$pagesOutput = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $manifest.artifact.pagesOutput))
$expectedReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".wrangler\release-pipeline"))
if (-not $sourceRoot.StartsWith($expectedReleaseRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $pagesOutput.StartsWith($sourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Release artifact path is outside the ignored release workspace."
}

function Get-MigrationSchemaState {
  param(
    [Parameter(Mandatory = $true)]$Migration,
    [Parameter(Mandatory = $true)][string]$TargetName,
    [Parameter(Mandatory = $true)][string]$SourceDirectory
  )

  $tableNames = @(@($Migration.preconditions.tables) + @($Migration.postconditions.tables) | Select-Object -Unique)
  $indexNames = @($Migration.postconditions.indexes)
  $triggerNames = @($Migration.postconditions.triggers)
  foreach ($name in @($tableNames + $indexNames + $triggerNames)) {
    if ($name -notmatch '^[A-Za-z0-9_]+$') { throw "Unexpected schema identifier in migration ledger: $name" }
  }
  $clauses = @()
  if ($tableNames.Count -gt 0) {
    $quoted = ($tableNames | ForEach-Object { "'$_'" }) -join ","
    $clauses += "(type='table' AND name IN ($quoted))"
  }
  if ($indexNames.Count -gt 0) {
    $quoted = ($indexNames | ForEach-Object { "'$_'" }) -join ","
    $clauses += "(type='index' AND name IN ($quoted))"
  }
  if ($triggerNames.Count -gt 0) {
    $quoted = ($triggerNames | ForEach-Object { "'$_'" }) -join ","
    $clauses += "(type='trigger' AND name IN ($quoted))"
  }
  $selects = @("SELECT type AS kind,name AS object_name,'' AS detail FROM sqlite_master WHERE $($clauses -join ' OR ')")
  foreach ($table in @($Migration.postconditions.tables)) {
    $selects += "SELECT 'column' AS kind,'$table' AS object_name,name AS detail FROM pragma_table_info('$table')"
  }
  $query = "$($selects -join ' UNION ALL ') ORDER BY kind,object_name,detail"
  $queryArgs = @("wrangler", "d1", "execute", $Migration.databaseBinding, "--remote", "--command", $query, "--json", "--cwd", $SourceDirectory)
  if ($TargetName -ne "preview") { $queryArgs += @("--env", "production") }
  $output = & npx @queryArgs 2>$null
  if ($LASTEXITCODE -ne 0) { throw "Could not read the $TargetName D1 schema for migration $($Migration.id)." }
  try { $responses = @(($output | Out-String) | ConvertFrom-Json -ErrorAction Stop) }
  catch { throw "Wrangler returned unreadable schema JSON for $TargetName migration $($Migration.id)." }
  if ($responses.Count -ne 1 -or $responses[0].success -ne $true) {
    throw "D1 schema query did not complete for $TargetName migration $($Migration.id)."
  }
  $objects = @($responses[0].results)
  $missingObjects = @()
  foreach ($table in @($Migration.postconditions.tables)) {
    if (-not @($objects | Where-Object { $_.kind -eq "table" -and $_.object_name -eq $table }).Count) { $missingObjects += $table }
  }
  foreach ($index in @($Migration.postconditions.indexes)) {
    if (-not @($objects | Where-Object { $_.kind -eq "index" -and $_.object_name -eq $index }).Count) { $missingObjects += $index }
  }
  foreach ($trigger in @($Migration.postconditions.triggers)) {
    if (-not @($objects | Where-Object { $_.kind -eq "trigger" -and $_.object_name -eq $trigger }).Count) { $missingObjects += $trigger }
  }
  $allObjectsPresent = $missingObjects.Count -eq 0
  $anyMigrationObjectPresent = @($objects | Where-Object {
    ($_.kind -eq "table" -and $Migration.postconditions.tables -contains $_.object_name) -or
    ($_.kind -eq "index" -and $Migration.postconditions.indexes -contains $_.object_name) -or
    ($_.kind -eq "trigger" -and $Migration.postconditions.triggers -contains $_.object_name)
  }).Count -gt 0
  $preconditionsPresent = @($Migration.preconditions.tables | Where-Object {
    $preconditionTable = $_
    -not @($objects | Where-Object { $_.kind -eq "table" -and $_.object_name -eq $preconditionTable }).Count
  }).Count -eq 0
  $allColumnsPresent = $true
  foreach ($table in @($Migration.postconditions.tables)) {
    $columnKey = "${table}Columns"
    $expectedColumns = @($Migration.postconditions.$columnKey)
    foreach ($column in $expectedColumns) {
      if (-not @($objects | Where-Object { $_.kind -eq "column" -and $_.object_name -eq $table -and $_.detail -eq $column }).Count) {
        $allColumnsPresent = $false
      }
    }
  }
  return [pscustomobject]@{
    AllPostconditionsPresent = ($allObjectsPresent -and $allColumnsPresent)
    AnyMigrationObjectPresent = $anyMigrationObjectPresent
    PreconditionsPresent = $preconditionsPresent
  }
}

function Invoke-ReleaseMigrations {
  param(
    [Parameter(Mandatory = $true)][string]$TargetName,
    [Parameter(Mandatory = $true)]$TargetConfiguration,
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
    [Parameter(Mandatory = $true)]$ReleaseManifest
  )

  $migrations = @($ReleaseManifest.migrations)
  if ($migrations.Count -eq 0) { return }
  $environmentName = if ($TargetName -eq "preview") { "preview" } else { "production" }
  $bindingMap = $TargetConfiguration.bindings.$environmentName.d1
  $receipts = @()
  foreach ($migration in $migrations) {
    $expectedDatabaseId = $migration.databaseIds.$TargetName
    $actualDatabaseId = $bindingMap.($migration.databaseBinding)
    if (-not $expectedDatabaseId -or $actualDatabaseId -ne $expectedDatabaseId) {
      throw "Migration $($migration.id) database target does not match the verified $TargetName configuration."
    }
    $state = Get-MigrationSchemaState -Migration $migration -TargetName $TargetName -SourceDirectory $SourceDirectory
    $outcome = "already-present"
    if (-not $state.AllPostconditionsPresent) {
      if ($state.AnyMigrationObjectPresent) { throw "Migration $($migration.id) is only partially present in $TargetName D1; stopping before SQL changes." }
      if (-not $state.PreconditionsPresent) { throw "Migration $($migration.id) precondition tables are missing in $TargetName D1." }
      $migrationPath = [System.IO.Path]::GetFullPath((Join-Path $SourceDirectory $migration.file))
      if (-not $migrationPath.StartsWith($SourceDirectory, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Migration path escaped the immutable source archive." }
      $migrationArgs = @("wrangler", "d1", "execute", $migration.databaseBinding, "--remote", "--file", $migrationPath, "--yes", "--cwd", $SourceDirectory)
      if ($TargetName -ne "preview") { $migrationArgs += @("--env", "production") }
      & npx @migrationArgs
      if ($LASTEXITCODE -ne 0) { throw "Migration $($migration.id) failed on $TargetName D1; deployment stopped." }
      $outcome = "applied"
      $state = Get-MigrationSchemaState -Migration $migration -TargetName $TargetName -SourceDirectory $SourceDirectory
      if (-not $state.AllPostconditionsPresent) { throw "Migration $($migration.id) did not satisfy all $TargetName schema postconditions." }
    }
    $receipts += [ordered]@{
      id = $migration.id
      sha256 = $migration.sha256
      databaseId = $actualDatabaseId
      outcome = $outcome
      postconditionsVerified = $true
    }
  }
  $receipt = [ordered]@{
    target = $TargetName
    projectName = $TargetConfiguration.projectName
    commitSha = $ReleaseManifest.commitSha
    manifestSha256 = $ReleaseManifest.manifestSha256
    databaseId = $receipts[0].databaseId
    migrations = $receipts
    verified = $true
    verifiedAt = [DateTime]::UtcNow.ToString("o")
  }
  $receiptPath = Join-Path $ReleaseDirectory "$TargetName-migrations.json"
  Write-JsonNoBom -Path $receiptPath -Value $receipt
  Write-Host "$TargetName D1 migration postconditions verified."
}

node.exe $pipeline verify-artifact --release-id $ReleaseId
if ($LASTEXITCODE -ne 0) { throw "Release artifact verification failed." }

# Run release-source regressions against the exact pushed commit, not the current checkout.
$checks = @(
  "test-account-auth.js",
  "test-account-native-ui.js",
  "test-creator-pdf-intake.js",
  "test-member-profile-access.js",
  "test-member-profile-library.js",
  "test-member-profiles.js",
  "test-common-membership-dashboard.js",
  "test-storefront-shared-cabinet.js",
  "test-progressive-privilege-navigation.js",
  "test-pages-build-output.js",
  "test-pages-environment-isolation.js",
  "test-storefront-visual-alignment.js"
)
foreach ($check in $checks) {
  & node.exe (Join-Path $sourceRoot "scripts\$check")
  if ($LASTEXITCODE -ne 0) { throw "Release regression failed: $check" }
}

$configPath = Join-Path $sourceRoot "wrangler.toml"
if (Test-Path -LiteralPath $configPath) { throw "Unexpected Wrangler config already exists in the release workspace." }
& npx wrangler pages download config $targetConfig.projectName --cwd $sourceRoot --force
if ($LASTEXITCODE -ne 0) { throw "Could not download target Pages configuration." }
if (-not (Test-Path -LiteralPath $configPath)) { throw "Cloudflare did not write the target Wrangler config." }

# Wrangler can emit an empty placement table which its deploy parser rejects; remove only that empty temp table.
$configText = Get-Content -LiteralPath $configPath -Raw
$configText = [regex]::Replace($configText, '(?m)^\[placement\]\s*(?=\r?\n|$)', "")
[System.IO.File]::WriteAllText($configPath, $configText, $utf8NoBom)
node.exe $pipeline check-environment --target $Target --config $configPath
if ($LASTEXITCODE -ne 0) { throw "Target Pages bindings or variables do not match ops/release/environments.json." }

$wranglerEnvironment = if ($Target -eq "preview") { "preview" } else { "production" }
$deploymentListPath = Join-Path $releaseRoot "$Target-deployments.json"
$deploymentListOutput = & npx wrangler pages deployment list --project-name $targetConfig.projectName --environment $wranglerEnvironment --cwd $sourceRoot --json
if ($LASTEXITCODE -ne 0) { throw "Could not verify the target project's current deployment branch." }
$deploymentList = ($deploymentListOutput | Out-String) | ConvertFrom-Json
$matchingCurrent = @($deploymentList | Where-Object {
  $_.Environment -eq $targetConfig.deploymentEnvironment -and
  $_.Branch -eq $targetConfig.deploymentBranch -and
  [string]$_.Status -notmatch '(?i)(failure|failed|cancel|skip|build|deploy|queue|progress)'
})
if ($matchingCurrent.Count -eq 0) {
  throw "No successful deployment proves that $($targetConfig.projectName) maps branch $($targetConfig.deploymentBranch) to $($targetConfig.deploymentEnvironment)."
}
if ($Target -eq "preview") {
  if ($targetConfig.deploymentBranch -eq $targetConfig.projectProductionBranch) {
    throw "Preview branch cannot equal the Pages project's production branch."
  }
  $productionListOutput = & npx wrangler pages deployment list --project-name $targetConfig.projectName --environment production --cwd $sourceRoot --json
  if ($LASTEXITCODE -ne 0) { throw "Could not verify the Preview project's production guard branch." }
  $productionList = ($productionListOutput | Out-String) | ConvertFrom-Json
  $guardDeployment = @($productionList | Where-Object {
    $_.Environment -eq "Production" -and $_.Branch -eq $targetConfig.projectProductionBranch
  })
  if ($guardDeployment.Count -eq 0) {
    throw "No production deployment proves that $($targetConfig.projectName) retains its configured guard branch."
  }
} elseif ($targetConfig.deploymentBranch -ne $targetConfig.projectProductionBranch) {
  throw "$Target deployment branch does not match the configured Pages production branch."
}

if ($Target -eq "production") {
  $previous = $matchingCurrent | Select-Object -First 1
  try {
    $previousMarker = Invoke-RestMethod -Uri "$($previous.Deployment.TrimEnd('/'))/trg-release.json" -Method Get -TimeoutSec 20
  } catch {
    throw "The selected production rollback deployment does not serve a readable release marker."
  }
  if (-not $previousMarker.commitSha -or -not $previous.Source.StartsWith([string]$previousMarker.commitSha.Substring(0, [Math]::Min(7, $previousMarker.commitSha.Length)), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The selected production rollback deployment marker does not match its Cloudflare source SHA."
  }
  $rollbackPath = Join-Path $releaseRoot "rollback-snapshot.json"
  $rollback = [ordered]@{
    deploymentId = $previous.Id
    deploymentUrl = $previous.Deployment
    branch = $previous.Branch
    environment = $previous.Environment
    source = $previous.Source
    capturedAt = [DateTime]::UtcNow.ToString("o")
  }
  if (Test-Path -LiteralPath $rollbackPath) {
    $existingRollback = Get-Content -LiteralPath $rollbackPath -Raw | ConvertFrom-Json
    if ($existingRollback.deploymentId -ne $rollback.deploymentId -or $existingRollback.deploymentUrl -ne $rollback.deploymentUrl) {
      throw "The saved rollback snapshot does not match the latest production deployment; inspect it before retrying."
    }
  } else {
  Write-JsonNoBom -Path $rollbackPath -Value $rollback
  }
}

node.exe $pipeline check-promotion --target $Target --release-id $ReleaseId --preflight
if ($LASTEXITCODE -ne 0) { throw "Promotion preflight failed; no migration or deployment was started." }

Invoke-ReleaseMigrations -TargetName $Target -TargetConfiguration $targetConfig -SourceDirectory $sourceRoot -ReleaseDirectory $releaseRoot -ReleaseManifest $manifest

node.exe $pipeline check-promotion --target $Target --release-id $ReleaseId
if ($LASTEXITCODE -ne 0) { throw "Promotion gate failed after migration verification; no deployment was started." }

$deployArgs = @(
  "wrangler", "pages", "deploy", $pagesOutput,
  "--cwd", $sourceRoot,
  "--project-name", $targetConfig.projectName,
  "--branch", $targetConfig.deploymentBranch,
  "--commit-hash", $manifest.commitSha,
  "--commit-message", $manifest.commitMessage,
  "--commit-dirty=false"
)
$deployOutput = & npx @deployArgs 2>&1
if ($LASTEXITCODE -ne 0) { $deployOutput | ForEach-Object { Write-Host $_ }; throw "Cloudflare Pages deployment failed." }
$deployOutput | ForEach-Object { Write-Host $_ }
$deployText = $deployOutput | Out-String
$urlPattern = 'https://[a-f0-9]{8}\.' + [regex]::Escape($targetConfig.projectName) + '\.pages\.dev'
$urlMatch = [regex]::Match($deployText, $urlPattern)
if (-not $urlMatch.Success) { throw "Deployment completed without an immutable Pages URL in Wrangler output." }
$deploymentUrl = $urlMatch.Value

$deploymentListOutput = & npx wrangler pages deployment list --project-name $targetConfig.projectName --environment $wranglerEnvironment --cwd $sourceRoot --json
if ($LASTEXITCODE -ne 0) { throw "Deployment completed but its Cloudflare metadata could not be read." }
$deploymentList = ($deploymentListOutput | Out-String) | ConvertFrom-Json
$deployment = $deploymentList | Where-Object { $_.Deployment -eq $deploymentUrl } | Select-Object -First 1
if (-not $deployment) { throw "Deployment URL was not found in the target Pages deployment metadata." }
$deploymentListPath = Join-Path $releaseRoot "$Target-deployments.json"
Write-JsonNoBom -Path $deploymentListPath -Value $deploymentList
node.exe $pipeline record-deployment --target $Target --release-id $ReleaseId --deployment-id $deployment.Id --deployment-list $deploymentListPath
if ($LASTEXITCODE -ne 0) { throw "Deployment metadata or deployed release marker did not match the manifest." }

Write-Host "Review URL: $deploymentUrl"
Write-Host "Deployment ID: $($deployment.Id)"

if ($Target -eq "staging") {
  & (Join-Path $PSScriptRoot "verify-staging.ps1") -ReleaseId $ReleaseId
  if ($LASTEXITCODE -ne 0) { throw "Staging deployment verification failed." }
}
if ($Target -eq "production") {
  & (Join-Path $PSScriptRoot "verify-production.ps1") -ReleaseId $ReleaseId -AllowProductionSmoke
  if ($LASTEXITCODE -ne 0) { throw "Production smoke verification failed." }
  node.exe $pipeline finalize-record --release-id $ReleaseId
  if ($LASTEXITCODE -ne 0) { throw "Release record could not be finalized." }
}
