using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Alive")]
[assembly: System.Reflection.AssemblyProduct("Alive")]
[assembly: System.Reflection.AssemblyDescription("Alive desktop companion")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

namespace AliveDesktopLauncher
{
    internal static class Program
    {
        private static void Log(string baseDir, string message)
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(baseDir, "desktop-launcher.log"),
                    DateTime.Now.ToString("o") + " " + message + "\r\n"
                );
            }
            catch
            {
                // The diagnostic log must never block startup.
            }
        }

        private static Process LaunchElectron(
            string baseDir,
            string electron,
            string app,
            bool noSandbox
        )
        {
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = electron;
            start.Arguments =
                (noSandbox ? "--no-sandbox " : "") + "\"" + app + "\"";
            start.WorkingDirectory = baseDir;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.EnvironmentVariables["ALIVE_DESKTOP_PACKAGED"] = "1";
            start.EnvironmentVariables["ALIVE_DESKTOP_PORTABLE"] = "1";
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Log(baseDir, "starting electron args=" + start.Arguments);
            return Process.Start(start);
        }

        [STAThread]
        private static void Main()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string electron = Path.Combine(baseDir, "electron.exe");
            string app = Path.Combine(baseDir, "resources", "app");

            Log(baseDir, "launcher start base=" + baseDir);

            if (!File.Exists(electron) || !Directory.Exists(app))
            {
                Log(baseDir, "missing electron or app");
                MessageBox.Show(
                    "Alive 桌面版的运行时文件不完整。\r\n请重新解压整个文件夹，不要只复制 Alive.exe。",
                    "Alive 无法启动",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            try
            {
                Process first = LaunchElectron(baseDir, electron, app, false);
                if (first == null)
                {
                    Log(baseDir, "normal launch returned null");
                    return;
                }
                Log(baseDir, "electron pid=" + first.Id);

                // Some Windows environments block Chromium's sandbox. If the
                // first process dies immediately, retry once in compatibility
                // mode instead of leaving a silent, invisible failure.
                if (first.WaitForExit(2500))
                {
                    Log(baseDir, "normal electron exited; retrying with --no-sandbox");
                    Process retry = LaunchElectron(baseDir, electron, app, true);
                    if (retry != null)
                    {
                        Log(baseDir, "compatibility electron pid=" + retry.Id);
                        retry.WaitForExit();
                    }
                }
                else
                {
                    first.WaitForExit();
                }
                Log(baseDir, "electron exited");
            }
            catch (Exception error)
            {
                Log(baseDir, "exception " + error.ToString());
                MessageBox.Show(
                    "Alive 启动失败：\r\n" + error.Message,
                    "Alive 无法启动",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
