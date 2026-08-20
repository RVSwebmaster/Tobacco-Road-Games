using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

public sealed class TrgRemote : Form
{
    private readonly Color panel = Color.FromArgb(28, 25, 21);
    private readonly Color gold = Color.FromArgb(214, 168, 85);
    private readonly Color text = Color.FromArgb(243, 234, 217);

    public TrgRemote()
    {
        Text = "TRG Remote";
        ClientSize = new Size(540, 600);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        BackColor = Color.FromArgb(17, 16, 14);
        ForeColor = text;
        Font = new Font("Segoe UI", 10);

        AddLabel("TOBACCO ROAD GAMES", 26, 24, 488, 24, 12, gold);
        AddLabel("TRG Remote", 26, 51, 488, 45, 25, text, true);
        AddLabel("Office and live store controls", 26, 98, 488, 26, 10, Color.FromArgb(170, 158, 139));

        AddLaunchButton("Office Repo", "https://office-staging.tobaccoroadgames.com/office/", 142, panel);
        AddLaunchButton("Product Intake", "https://tobaccoroadgames.com/owner/intake", 207, panel);
        AddLaunchButton("Ad Depot", "https://tobaccoroadgames.com/ad-depot", 272, panel);

        AddLabel("STORE KILL SWITCH", 26, 347, 488, 25, 11, gold);
        AddLaunchButton("OPEN", "https://tobaccoroadgames.com/owner/store-status?set=OPEN", 383, Color.FromArgb(45, 82, 55));
        AddLaunchButton("CLOSED", "https://tobaccoroadgames.com/owner/store-status?set=CLOSED", 448, Color.FromArgb(105, 48, 38));
        AddLaunchButton("MAINTENANCE", "https://tobaccoroadgames.com/owner/store-status?set=MAINTENANCE", 513, Color.FromArgb(79, 62, 33));
    }

    private void AddLabel(string value, int left, int top, int width, int height, float size, Color color, bool serif = false)
    {
        var label = new Label {
            Text = value, Location = new Point(left, top), Size = new Size(width, height),
            Font = new Font(serif ? "Georgia" : "Segoe UI Semibold", size, serif ? FontStyle.Bold : FontStyle.Regular),
            ForeColor = color, TextAlign = ContentAlignment.MiddleCenter
        };
        Controls.Add(label);
    }

    private void AddLaunchButton(string label, string url, int top, Color color)
    {
        var button = new Button {
            Text = label, Location = new Point(65, top), Size = new Size(410, 52), BackColor = color,
            ForeColor = text, FlatStyle = FlatStyle.Flat, Font = new Font("Segoe UI Semibold", 13),
            Cursor = Cursors.Hand
        };
        button.FlatAppearance.BorderColor = gold;
        button.Click += (sender, args) => {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch { MessageBox.Show("Windows could not open the configured address.", "TRG Remote", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        };
        Controls.Add(button);
    }
}

public static class Program
{
    [STAThread]
    public static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrgRemote());
    }
}
