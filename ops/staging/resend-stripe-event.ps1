[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^evt_[A-Za-z0-9]+$')]
  [string]$EventId
)

$ErrorActionPreference = "Stop"
$ExpectedWebhookUrl = "https://tobacco-road-games-staging.pages.dev/api/stripe/webhook"
# Registered Stripe sandbox endpoint for the TRG staging webhook. Both this ID
# and the exact URL below must match before a resend is permitted.
$ExpectedWebhookEndpointId = "we_1Tt8kt2Ou58YVanKsawLJ14G"

function Get-StripeCliPath {
  $command = Get-Command stripe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $wingetPath = Join-Path $env:LOCALAPPDATA `
    "Microsoft\WinGet\Packages\Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe\stripe.exe"
  if (Test-Path -LiteralPath $wingetPath) {
    return $wingetPath
  }
  throw "Stripe CLI is not installed. Install the official Stripe CLI before using this staging operation."
}

function Invoke-StripeJson {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  $captured = & $script:StripeCli @Arguments --color=off --log-level=error 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
  try {
    return $captured | ConvertFrom-Json
  } catch {
    throw $FailureMessage
  }
}

$StripeCli = Get-StripeCliPath

# The CLI defaults to test mode. The retrieved Event must also explicitly say
# livemode=false before the resend is permitted.
$stripeEvent = Invoke-StripeJson `
  -Arguments @("events", "retrieve", $EventId) `
  -FailureMessage "Stripe CLI authentication or sandbox Event retrieval failed. Run 'stripe login' once, then retry."
if ($stripeEvent.livemode -ne $false) {
  throw "Refusing to resend a live-mode Stripe Event from the staging operation."
}

$webhookEndpoints = Invoke-StripeJson `
  -Arguments @("webhook_endpoints", "list", "--limit=100") `
  -FailureMessage "The staging webhook endpoint could not be discovered through Stripe CLI."
$matchingEndpoints = @($webhookEndpoints.data | Where-Object { $_.url -ceq $ExpectedWebhookUrl })
if ($matchingEndpoints.Count -ne 1) {
  throw "Expected exactly one TRG staging webhook endpoint at $ExpectedWebhookUrl; refusing to choose another endpoint."
}

$endpointId = [string]$matchingEndpoints[0].id
if ($endpointId -notmatch '^we_[A-Za-z0-9]+$') {
  throw "The discovered TRG staging webhook endpoint ID is invalid."
}
if ($ExpectedWebhookEndpointId -and $endpointId -cne $ExpectedWebhookEndpointId) {
  throw "The discovered endpoint does not match the documented TRG staging webhook endpoint ID."
}

# Capture and discard the CLI response so the Stripe Event payload and customer
# details never reach the console or the runbook log.
$null = & $StripeCli events resend $EventId `
  "--webhook-endpoint=$endpointId" `
  --confirm `
  --color=off `
  --log-level=error 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  throw "Stripe declined or could not complete the staging Event resend."
}

[pscustomobject]@{
  event_id = $EventId
  test_mode = $true
  webhook_endpoint_id = $endpointId
  webhook_url = $ExpectedWebhookUrl
  status = "resend_requested"
}
