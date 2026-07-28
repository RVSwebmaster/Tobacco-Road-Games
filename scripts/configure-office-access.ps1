[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$accountId = "5d75bd5036e763952313fa55078f5e42"
$apiBase = "https://api.cloudflare.com/client/v4"
$applicationName = "TRG Office Archive $([char]0x2014) Staging"
$applicationDomain = "office-staging.tobaccoroadgames.com/office/*"
$policyName = "Office Access"
$ownerEmail = "rvsawyer1967@gmail.com"

$tokenPlaintext = $null
$tokenPointer = [IntPtr]::Zero
$headers = $null

function Invoke-CloudflareApi {
    param(
        [Parameter(Mandatory)]
        [ValidateSet("GET", "POST", "PATCH")]
        [string] $Method,

        [Parameter(Mandatory)]
        [string] $Path,

        [object] $Body
    )

    $request = @{
        Uri = "$apiBase$Path"
        Method = $Method
        Headers = $headers
        ContentType = "application/json"
    }

    if ($null -ne $Body) {
        $request.Body = $Body | ConvertTo-Json -Depth 20 -Compress
    }

    try {
        $response = Invoke-RestMethod @request
    }
    catch {
        $statusCode = $null
        $cloudflareMessage = $null
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode

            try {
                $responseStream = $_.Exception.Response.GetResponseStream()
                $reader = [System.IO.StreamReader]::new($responseStream)
                $errorBody = $reader.ReadToEnd()
                $reader.Dispose()
                $responseStream.Dispose()

                if (-not [string]::IsNullOrWhiteSpace($tokenPlaintext)) {
                    $errorBody = $errorBody.Replace($tokenPlaintext, "[redacted]")
                }

                $errorEnvelope = $errorBody | ConvertFrom-Json
                $cloudflareMessage = @(
                    $errorEnvelope.errors |
                        ForEach-Object { "[$($_.code)] $($_.message)" }
                ) -join "; "
            }
            catch {
                $cloudflareMessage = $null
            }
        }

        if ($statusCode) {
            if (-not [string]::IsNullOrWhiteSpace($cloudflareMessage)) {
                throw "Cloudflare API request failed: $Method $Path returned HTTP $statusCode`: $cloudflareMessage"
            }

            throw "Cloudflare API request failed: $Method $Path returned HTTP $statusCode."
        }

        throw "Cloudflare API request failed: $Method $Path."
    }

    if (-not $response.success) {
        $messages = @($response.errors | ForEach-Object { "[$($_.code)] $($_.message)" })
        throw "Cloudflare API rejected $Method $Path`: $($messages -join '; ')"
    }

    return $response.result
}

function Get-AllCloudflareResults {
    param(
        [Parameter(Mandatory)]
        [string] $Path
    )

    $separator = if ($Path.Contains("?")) { "&" } else { "?" }
    return @(Invoke-CloudflareApi -Method GET -Path "$Path${separator}page=1&per_page=100")
}

function Test-ExactEmailPolicy {
    param(
        [Parameter(Mandatory)]
        [object] $Policy
    )

    if ($Policy.name -cne $policyName -or $Policy.decision -cne "allow") {
        return $false
    }

    if (@($Policy.include).Count -ne 1) {
        return $false
    }

    $includeRule = @($Policy.include)[0]
    $includeProperties = @($includeRule.PSObject.Properties.Name)
    if ($includeProperties.Count -ne 1 -or $includeProperties[0] -cne "email") {
        return $false
    }

    if ($null -eq $includeRule.email -or
        $includeRule.email.email -cne $ownerEmail -or
        @($includeRule.email.PSObject.Properties.Name).Count -ne 1) {
        return $false
    }

    if (@($Policy.exclude).Count -ne 0 -or @($Policy.require).Count -ne 0) {
        return $false
    }

    if ($Policy.approval_required -eq $true) {
        return $false
    }

    return $true
}

function Test-ExactApplicationSettings {
    param(
        [Parameter(Mandatory)]
        [object] $Application
    )

    $acceptedApplicationNames = @(
        $applicationName,
        "TRG Office Archive - Staging"
    )
    $clientlessProperty = $Application.PSObject.Properties[
        "use_clientless_isolation_app_launcher_url"
    ]
    $clientlessEnabled = (
        $null -ne $clientlessProperty -and
        $clientlessProperty.Value -is [bool] -and
        $clientlessProperty.Value -eq $true
    )

    return (
        $acceptedApplicationNames -ccontains $Application.name -and
        $Application.type -ceq "self_hosted" -and
        $Application.domain -ceq $applicationDomain -and
        $Application.session_duration -ceq "8h" -and
        $Application.app_launcher_visible -eq $false -and
        -not $clientlessEnabled
    )
}

function Get-ApplicationSettingsFailure {
    param(
        [Parameter(Mandatory)]
        [object] $Application
    )

    $failures = [System.Collections.Generic.List[string]]::new()
    $acceptedApplicationNames = @(
        $applicationName,
        "TRG Office Archive - Staging"
    )
    if ($acceptedApplicationNames -cnotcontains $Application.name) {
        $failures.Add("name mismatch")
    }
    if ($Application.type -cne "self_hosted") {
        $failures.Add("type mismatch")
    }
    if ($Application.domain -cne $applicationDomain) {
        $failures.Add("domain mismatch")
    }
    if ($Application.session_duration -cne "8h") {
        $failures.Add("session_duration mismatch (returned '$($Application.session_duration)')")
    }
    if ($Application.app_launcher_visible -isnot [bool] -or
        $Application.app_launcher_visible -ne $false) {
        $failures.Add("app_launcher_visible was not Boolean false")
    }

    $clientlessProperty = $Application.PSObject.Properties[
        "use_clientless_isolation_app_launcher_url"
    ]
    if ($null -ne $clientlessProperty -and
        $clientlessProperty.Value -is [bool] -and
        $clientlessProperty.Value -eq $true) {
        $failures.Add("use_clientless_isolation_app_launcher_url was Boolean true")
    }

    return $failures -join "; "
}

try {
    $secureToken = Read-Host "Cloudflare API token" -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $tokenPlaintext = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $secureToken.Dispose()
    $secureToken = $null

    if ([string]::IsNullOrWhiteSpace($tokenPlaintext)) {
        throw "No Cloudflare API token was entered."
    }

    $headers = @{
        Authorization = "Bearer $tokenPlaintext"
    }

    # Complete the required read-only Access inspection before any mutation.
    $applications = Get-AllCloudflareResults -Path "/accounts/$accountId/access/apps"
    $reusablePolicies = Get-AllCloudflareResults -Path "/accounts/$accountId/access/policies"

    $applicationCandidates = @(
        $applications | Where-Object {
            $_.name -ceq $applicationName -or $_.domain -ceq $applicationDomain
        }
    )

    if ($applicationCandidates.Count -gt 1) {
        $candidateIds = @($applicationCandidates | ForEach-Object { $_.id }) -join ", "
        throw "Multiple Office Access application candidates exist ($candidateIds). Nothing was changed."
    }

    $existingApplication = $null
    if ($applicationCandidates.Count -eq 1) {
        $existingApplication = Invoke-CloudflareApi -Method GET -Path "/accounts/$accountId/access/apps/$($applicationCandidates[0].id)"
    }

    $policyNameCandidates = @(
        $reusablePolicies | Where-Object { $_.name -ceq $policyName }
    )

    if ($policyNameCandidates.Count -gt 1) {
        $candidateIds = @($policyNameCandidates | ForEach-Object { $_.id }) -join ", "
        throw "Multiple reusable policies named '$policyName' exist ($candidateIds). Nothing was changed."
    }

    $selectedPolicy = $null
    if ($policyNameCandidates.Count -eq 1) {
        $candidate = $policyNameCandidates[0]
        if (-not (Test-ExactEmailPolicy -Policy $candidate)) {
            throw "Reusable policy '$policyName' ($($candidate.id)) is malformed. Nothing was changed or deleted."
        }

        $candidateAppCount = [int]$candidate.app_count
        if ($candidateAppCount -gt 0) {
            if ($null -ne $existingApplication -and
                -not (Test-ExactApplicationSettings -Application $existingApplication)) {
                $settingsFailure = Get-ApplicationSettingsFailure -Application $existingApplication
                throw "Office Access application candidate ($($existingApplication.id)) failed settings verification: $settingsFailure. Nothing was changed or deleted."
            }

            $safeExistingApplication = (
                $null -ne $existingApplication -and
                (Test-ExactApplicationSettings -Application $existingApplication) -and
                @($existingApplication.policies).Count -eq 1 -and
                @($existingApplication.policies)[0].id -ceq $candidate.id
            )

            if (-not $safeExistingApplication) {
                throw "Reusable policy '$policyName' ($($candidate.id)) is already attached to another or unverifiable application. Nothing was changed."
            }
        }

        $selectedPolicy = $candidate
    }
    else {
        $selectedPolicy = Invoke-CloudflareApi -Method POST -Path "/accounts/$accountId/access/policies" -Body @{
            name = $policyName
            decision = "allow"
            reusable = $true
            include = @(
                @{
                    email = @{
                        email = $ownerEmail
                    }
                }
            )
            exclude = @()
            require = @()
            approval_required = $false
        }
    }

    $application = $null
    if ($null -ne $existingApplication) {
        if (-not (Test-ExactApplicationSettings -Application $existingApplication)) {
            $settingsFailure = Get-ApplicationSettingsFailure -Application $existingApplication
            throw "Office Access application candidate ($($existingApplication.id)) failed settings verification: $settingsFailure. Nothing was changed or deleted."
        }

        if (@($existingApplication.policies).Count -ne 1 -or
            @($existingApplication.policies)[0].id -cne $selectedPolicy.id) {
            throw "Office Access application candidate ($($existingApplication.id)) does not have only the approved policy. Nothing was changed or deleted."
        }

        $application = $existingApplication
    }
    else {
        $application = Invoke-CloudflareApi -Method POST -Path "/accounts/$accountId/access/apps" -Body @{
            name = $applicationName
            type = "self_hosted"
            domain = $applicationDomain
            session_duration = "8h"
            app_launcher_visible = $false
            policies = @(
                @{
                    id = $selectedPolicy.id
                    precedence = 1
                }
            )
        }
    }

    $verifiedApplication = Invoke-CloudflareApi -Method GET -Path "/accounts/$accountId/access/apps/$($application.id)"
    $verifiedPolicies = @(
        Get-AllCloudflareResults -Path "/accounts/$accountId/access/apps/$($application.id)/policies"
    )

    if (-not (Test-ExactApplicationSettings -Application $verifiedApplication)) {
        $settingsFailure = Get-ApplicationSettingsFailure -Application $verifiedApplication
        throw "Created application ($($application.id)) failed settings verification: $settingsFailure."
    }

    if ([string]::IsNullOrWhiteSpace($verifiedApplication.aud)) {
        throw "Created application ($($application.id)) did not return an Audience tag."
    }

    if ($verifiedPolicies.Count -ne 1 -or
        $verifiedPolicies[0].id -cne $selectedPolicy.id -or
        -not (Test-ExactEmailPolicy -Policy $verifiedPolicies[0])) {
        throw "Created application ($($application.id)) failed exact-policy verification."
    }

    [pscustomobject]@{
        success = $true
        application_id = $verifiedApplication.id
        aud = $verifiedApplication.aud
        domain = $verifiedApplication.domain
        policy = @{
            id = $verifiedPolicies[0].id
            name = $verifiedPolicies[0].name
            decision = $verifiedPolicies[0].decision
            email = $verifiedPolicies[0].include[0].email.email
        }
    } | ConvertTo-Json -Depth 5
}
finally {
    if ($null -ne $headers) {
        $headers.Clear()
    }

    $headers = $null
    $tokenPlaintext = $null

    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
        $tokenPointer = [IntPtr]::Zero
    }

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
