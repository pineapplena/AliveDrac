using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Alive")]
[assembly: System.Reflection.AssemblyProduct("Alive")]
[assembly: System.Reflection.AssemblyDescription("Alive local companion")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

namespace AliveLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string appDir = Path.Combine(baseDir, "app");
            string nodeExe = Path.Combine(baseDir, "runtime", "node.exe");
            string launcher = Path.Combine(appDir, "scripts", "launch.cjs");

            if (!File.Exists(nodeExe) || !File.Exists(launcher))
            {
                MessageBox.Show(
                    "Alive 的运行时文件不完整。\r\n请重新解压整个压缩包，不要只复制 Alive.exe。",
                    "Alive 无法启动",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            try
            {
                string port = "8790";

                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = nodeExe;
                start.Arguments = "\"" + launcher + "\"";
                start.WorkingDirectory = appDir;
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                start.EnvironmentVariables["ALIVE_ROOT"] = appDir;
                start.EnvironmentVariables["ALIVE_PORT"] = port;
                start.EnvironmentVariables.Remove("ALIVE_DATA_DIR");
                start.EnvironmentVariables.Remove("ALIVE_HOST");
                start.EnvironmentVariables.Remove("DEEPSEEK_API_KEY");
                start.EnvironmentVariables.Remove("ALIVE_LLM_BASE_URL");
                start.EnvironmentVariables.Remove("ALIVE_LLM_MODEL");
                Process.Start(start);
            }
            catch (Exception error)
            {
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
