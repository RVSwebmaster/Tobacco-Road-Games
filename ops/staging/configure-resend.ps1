param(
  [string]$ReplyTo
)

$ErrorActionPreference = "Stop"
$projectName = "tobacco-road-games-staging"

if (-not $ReplyTo) {
  $ReplyTo = Read-Host "Confirmed working Reply-To mailbox"
}
$ReplyTo = $ReplyTo.Trim().ToLowerInvariant()
if ($ReplyTo -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
  throw "Reply-To must be a complete confirmed email address."
}

$apiKeySecure = Read-Host "Resend API key (re_...)" -AsSecureString
$webhookSecretSecure = Read-Host "Resend webhook signing secret (whsec_...)" -AsSecureString
$apiKey = Convert-SecureValue $apiKeySecure
$webhookSecret = Convert-SecureValue $webhookSecretSecure
if (-not $apiKey.StartsWith("re_")) {
  throw "RESEND_API_KEY must begin with re_."
}
if (-not $webhookSecret.StartsWith("whsec_")) {
  throw "RESEND_WEBHOOK_SECRET must begin with whsec_."
}

$randomBytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($randomBytes)
} finally {
  $rng.Dispose()
}
$orderAccessSecret = [Convert]::ToBase64String($randomBytes)

try {
  Set-PagesSecret "RESEND_API_KEY" $apiKey
  Set-PagesSecret "RESEND_WEBHOOK_SECRET" $webhookSecret
  Set-PagesSecret "ORDER_ACCESS_SIGNING_SECRET" $orderAccessSecret
  Set-PagesSecret "RESEND_REPLY_TO" $ReplyTo
  Write-Output "Installed the four Work Order 5 staging values without printing their contents."
} finally {
  $apiKey = $null
  $webhookSecret = $null
  $orderAccessSecret = $null
  [Array]::Clear($randomBytes, 0, $randomBytes.Length)
}

function Set-PagesSecret([string]$Name, [string]$Value) {
  $output = $Value | npx wrangler pages secret put $Name --project-name $projectName 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Cloudflare rejected $Name. Wrangler output: $($output -join ' ')"
  }
  Write-Output "Installed $Name."
}

function Convert-SecureValue([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}
