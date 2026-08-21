using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

public sealed class TrgRemote : Form
{
    private readonly Color panel = Color.FromArgb(48, 56, 68);
    private readonly Color accent = Color.FromArgb(111, 205, 255);
    private readonly Color muted = Color.FromArgb(118, 132, 148);
    private readonly Color text = Color.FromArgb(223, 232, 241);

    public TrgRemote()
    {
        Text = "TRG Remote";
        ClientSize = new Size(118, 266);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.None;
        MaximizeBox = true;
        TopMost = true;
        ShowInTaskbar = true;
        BackColor = Color.FromArgb(22, 27, 35);
        ForeColor = text;
        Font = new Font("Segoe UI", 7);

        AddLabel("TRG", 21, 18, 76, 18, 9, accent);
        AddLabel("QUICK ACCESS", 21, 36, 76, 12, 5, muted);
        AddLaunchButton("Office Repo", "https://office-staging.tobaccoroadgames.com/office/", 58);
        AddLaunchButton("RV's Dashboard", "https://tobaccoroadgames.com/owner/", 108);
        AddLaunchButton("Ad Depot", "https://tobaccoroadgames.com/ad-depot", 158);

        var closeButton = new Button {
            Text = "×", Location = new Point(46, 218), Size = new Size(26, 26),
            BackColor = panel, ForeColor = muted, FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 10), Cursor = Cursors.Hand
        };
        closeButton.FlatAppearance.BorderColor = panel;
        closeButton.Click += (sender, args) => Close();
        Controls.Add(closeButton);
    }

    private void AddLabel(string value, int left, int top, int width, int height, float size, Color color)
    {
        var label = new Label {
            Text = value, Location = new Point(left, top), Size = new Size(width, height),
            Font = new Font("Segoe UI Semibold", size), ForeColor = color,
            TextAlign = ContentAlignment.MiddleCenter
        };
        Controls.Add(label);
    }

    private void AddLaunchButton(string label, string url, int top)
    {
        var button = new Button {
            Text = label, Location = new Point(16, top), Size = new Size(86, 44),
            BackColor = panel, ForeColor = text, FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI Semibold", 7), Cursor = Cursors.Hand
        };
        button.FlatAppearance.BorderColor = panel;
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
