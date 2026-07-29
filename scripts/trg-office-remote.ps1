Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

[System.Windows.Forms.Application]::EnableVisualStyles()

$background = [System.Drawing.Color]::FromArgb(17, 16, 14)
$panel = [System.Drawing.Color]::FromArgb(28, 25, 21)
$gold = [System.Drawing.Color]::FromArgb(214, 168, 85)
$text = [System.Drawing.Color]::FromArgb(243, 234, 217)
$muted = [System.Drawing.Color]::FromArgb(170, 158, 139)

$form = New-Object System.Windows.Forms.Form
$form.Text = "Tobacco Road Games Remote"
$form.ClientSize = New-Object System.Drawing.Size(520, 390)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.BackColor = $background
$form.ForeColor = $text
$form.Font = New-Object System.Drawing.Font("Segoe UI", 11)

$brand = New-Object System.Windows.Forms.Label
$brand.Text = "TOBACCO ROAD GAMES"
$brand.Location = New-Object System.Drawing.Point(36, 28)
$brand.Size = New-Object System.Drawing.Size(448, 28)
$brand.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 12)
$brand.ForeColor = $gold
$brand.TextAlign = "MiddleCenter"
$form.Controls.Add($brand)

$heading = New-Object System.Windows.Forms.Label
$heading.Text = "Office Remote"
$heading.Location = New-Object System.Drawing.Point(36, 58)
$heading.Size = New-Object System.Drawing.Size(448, 48)
$heading.Font = New-Object System.Drawing.Font("Georgia", 25, [System.Drawing.FontStyle]::Bold)
$heading.ForeColor = $text
$heading.TextAlign = "MiddleCenter"
$form.Controls.Add($heading)

$instructions = New-Object System.Windows.Forms.Label
$instructions.Text = "Choose a destination to open it in your default browser."
$instructions.Location = New-Object System.Drawing.Point(36, 111)
$instructions.Size = New-Object System.Drawing.Size(448, 30)
$instructions.ForeColor = $muted
$instructions.TextAlign = "MiddleCenter"
$form.Controls.Add($instructions)

function Add-LaunchButton {
    param(
        [string]$Label,
        [string]$Url,
        [int]$Top
    )

    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Label
    $button.Location = New-Object System.Drawing.Point(65, $Top)
    $button.Size = New-Object System.Drawing.Size(390, 62)
    $button.BackColor = $panel
    $button.ForeColor = $text
    $button.FlatStyle = "Flat"
    $button.FlatAppearance.BorderColor = $gold
    $button.FlatAppearance.BorderSize = 1
    $button.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 15)
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.Add_Click({
        try {
            Start-Process $Url
        } catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Windows could not open the configured address.",
                "TRG Office Remote",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Error
            )
        }
    }.GetNewClosure())
    $form.Controls.Add($button)
}

Add-LaunchButton -Label "Office Repo" -Url "https://office-staging.tobaccoroadgames.com/office/" -Top 160
Add-LaunchButton -Label "Intake" -Url "https://office-staging.tobaccoroadgames.com/office/intake" -Top 236

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = "Close"
$closeButton.Location = New-Object System.Drawing.Point(200, 322)
$closeButton.Size = New-Object System.Drawing.Size(120, 38)
$closeButton.BackColor = $panel
$closeButton.ForeColor = $muted
$closeButton.FlatStyle = "Flat"
$closeButton.FlatAppearance.BorderColor = $muted
$closeButton.Add_Click({ $form.Close() })
$form.Controls.Add($closeButton)

[void]$form.ShowDialog()
