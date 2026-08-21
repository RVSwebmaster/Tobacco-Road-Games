using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class TrgRemote : Form
{
    private readonly Color panel = Color.FromArgb(48, 56, 68);
    private readonly Color accent = Color.FromArgb(111, 205, 255);
    private readonly Color muted = Color.FromArgb(118, 132, 148);
    private readonly Color text = Color.FromArgb(223, 232, 241);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int message, IntPtr wParam, IntPtr lParam);

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
        ApplyRemoteShape();
        MouseDown += MoveRemote;

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
        closeButton.FlatAppearance.BorderColor = muted;
        closeButton.FlatAppearance.BorderSize = 1;
        closeButton.Click += (sender, args) => Close();
        Controls.Add(closeButton);
    }

    protected override void OnPaint(PaintEventArgs args)
    {
        base.OnPaint(args);
        args.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var outline = RoundedPath(new Rectangle(0, 0, ClientSize.Width - 1, ClientSize.Height - 1), 36))
        using (var pen = new Pen(Color.FromArgb(92, 106, 121)))
        {
            args.Graphics.DrawPath(pen, outline);
        }
    }

    private void ApplyRemoteShape()
    {
        using (var shape = RoundedPath(new Rectangle(0, 0, ClientSize.Width, ClientSize.Height), 38))
        {
            Region = new Region(shape);
        }
    }

    private static GraphicsPath RoundedPath(Rectangle bounds, int radius)
    {
        var path = new GraphicsPath();
        var diameter = radius * 2;
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    private void MoveRemote(object sender, MouseEventArgs args)
    {
        if (args.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(Handle, 0xA1, new IntPtr(0x2), IntPtr.Zero);
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
        button.FlatAppearance.BorderColor = muted;
        button.FlatAppearance.BorderSize = 1;
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
