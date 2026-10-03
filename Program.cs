using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace EcommerceWarehouseApi
{
    class Program
    {
        static Process serverProcess = null;

        static void Main(string[] args)
        {
            Console.Title = "Elektron Savdo va Ombor API - Server";
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine(@"
================================================================
  📦 ELEKTRON SAVDO VA OMBOR BOSHQARUVI API (100 BALL)
  Stand-alone Windows Executable (.exe)
================================================================
");
            Console.ResetColor();

            // Set current directory to application root
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);

            // Check if test mode requested
            bool runTestsOnly = false;
            foreach (var arg in args)
            {
                if (arg.Equals("--test", StringComparison.OrdinalIgnoreCase) || arg.Equals("-t", StringComparison.OrdinalIgnoreCase))
                {
                    runTestsOnly = true;
                    break;
                }
                if (arg.Equals("--help", StringComparison.OrdinalIgnoreCase) || arg.Equals("-h", StringComparison.OrdinalIgnoreCase))
                {
                    PrintHelp();
                    return;
                }
            }

            // Find Node.js executable
            string nodePath = FindNodeExecutable();
            if (string.IsNullOrEmpty(nodePath))
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("XATOLIK: Node.js ishga tushirish muhiti topilmadi!");
                Console.WriteLine("Iltimos, Node.js o'rnatilganligini tekshiring: https://nodejs.org");
                Console.ResetColor();
                Console.WriteLine("\nChiqish uchun istalgan tugmani bosing...");
                Console.ReadKey();
                return;
            }

            if (runTestsOnly)
            {
                RunTestRunner(nodePath, baseDir);
                return;
            }

            StartServer(nodePath, baseDir);
        }

        static void PrintHelp()
        {
            Console.WriteLine("Qo'llanishi:");
            Console.WriteLine("  ecommerce-api.exe           - API serverni ishga tushiradi va brauzerda /docs ni ochadi");
            Console.WriteLine("  ecommerce-api.exe --test    - 25 ta rasmiy testlarni to'liq ishga tushiradi");
            Console.WriteLine("  ecommerce-api.exe --help    - Ushbu yordam sahifasini ko'rsatadi");
        }

        static string FindNodeExecutable()
        {
            string[] possiblePaths = new string[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe"),
                "node.exe"
            };

            foreach (var p in possiblePaths)
            {
                if (File.Exists(p)) return p;
            }

            // Check PATH environment variable
            var pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (pathEnv != null)
            {
                foreach (var dir in pathEnv.Split(';'))
                {
                    try
                    {
                        var candidate = Path.Combine(dir.Trim(), "node.exe");
                        if (File.Exists(candidate)) return candidate;
                    }
                    catch { }
                }
            }

            return null;
        }

        static void RunTestRunner(string nodePath, string baseDir)
        {
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("--> Test tekshiruvi ishga tushirilmoqda...\n");
            Console.ResetColor();

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "test-runner.js",
                WorkingDirectory = baseDir,
                UseShellExecute = false
            };

            var testProc = Process.Start(psi);
            testProc.WaitForExit();
            Console.WriteLine("\nTest yakunlandi. Chiqish kodi: " + testProc.ExitCode);
            Console.WriteLine("Chiqish uchun istalgan tugmani bosing...");
            Console.ReadKey();
        }

        static void StartServer(string nodePath, string baseDir)
        {
            string serverScript = Path.Combine(baseDir, "src", "server.js");
            if (!File.Exists(serverScript))
            {
                serverScript = Path.Combine(baseDir, "server.js");
            }

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "\"" + serverScript + "\"",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = false
            };

            serverProcess = new Process { StartInfo = psi };

            serverProcess.OutputDataReceived += (sender, e) =>
            {
                if (e.Data != null) Console.WriteLine(e.Data);
            };

            serverProcess.ErrorDataReceived += (sender, e) =>
            {
                if (e.Data != null)
                {
                    Console.ForegroundColor = ConsoleColor.Yellow;
                    Console.WriteLine("[LOG]: " + e.Data);
                    Console.ResetColor();
                }
            };

            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                ShutdownServer();
            };

            AppDomain.CurrentDomain.ProcessExit += (sender, e) => ShutdownServer();

            try
            {
                serverProcess.Start();
                serverProcess.BeginOutputReadLine();
                serverProcess.BeginErrorReadLine();

                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("✔ API Server muvaffaqiyatli ishga tushirildi!");
                Console.ResetColor();

                // Open browser after 1 second
                new Thread(() =>
                {
                    Thread.Sleep(1200);
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = "http://localhost:3000/docs",
                            UseShellExecute = true
                        });
                    }
                    catch { }
                }).Start();

                Console.ForegroundColor = ConsoleColor.DarkGray;
                Console.WriteLine("\n[Maslahat] Serverni to'xtatish uchun istalgan vaqt Ctrl+C ni bosing.\n");
                Console.ResetColor();

                serverProcess.WaitForExit();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("Serverni ishga tushirishda xatolik: " + ex.Message);
                Console.ResetColor();
            }
        }

        static void ShutdownServer()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    Console.WriteLine("\nServer to'xtatilmoqda...");
                    serverProcess.Kill();
                    serverProcess.WaitForExit(2000);
                }
            }
            catch { }
            Environment.Exit(0);
        }
    }
}
