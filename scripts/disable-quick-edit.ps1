param([switch]$PassThru)

$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public sealed class EscandonConsoleModeResult
{
    public bool Success;
    public uint Before;
    public uint After;
    public string HandleSource;
    public int Error;
}

public static class EscandonConsoleInputMode
{
    private const uint EnableQuickEdit = 0x0040;
    private const uint EnableExtendedFlags = 0x0080;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetConsoleMode(IntPtr consoleHandle, out uint mode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleMode(IntPtr consoleHandle, uint mode);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share,
        IntPtr securityAttributes, uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeConsole();

    private static SafeFileHandle OpenConsoleInput()
    {
        return CreateFile("CONIN$", 0xC0000000u, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    }

    public static uint WithoutQuickEdit(uint mode)
    {
        // Windows requires ENABLE_EXTENDED_FLAGS to change QuickEdit.
        return (mode | EnableExtendedFlags) & ~EnableQuickEdit;
    }

    public static EscandonConsoleModeResult DisableQuickEditMode()
    {
        var result = new EscandonConsoleModeResult();
        IntPtr handle = GetStdHandle(-10);
        uint mode;
        SafeFileHandle owned = null;
        try
        {
            if (handle != IntPtr.Zero && handle != new IntPtr(-1) && GetConsoleMode(handle, out mode))
            {
                result.HandleSource = "stdin";
            }
            else
            {
                // Ignored stdio can give PowerShell a different hidden console.
                // Target the caller's console explicitly, without creating one.
                FreeConsole();
                AttachConsole(0xFFFFFFFFu);
                owned = OpenConsoleInput();
                if (owned.IsInvalid)
                {
                    owned.Dispose();
                    // A hidden child may have no console. Reattach to the parent;
                    // this does not allocate a window or replace the server process.
                    AttachConsole(0xFFFFFFFFu);
                    owned = OpenConsoleInput();
                }
                if (owned.IsInvalid || !GetConsoleMode(owned.DangerousGetHandle(), out mode))
                {
                    result.Error = Marshal.GetLastWin32Error();
                    return result;
                }
                handle = owned.DangerousGetHandle();
                result.HandleSource = "CONIN$";
            }
            result.Before = mode;
            if (!SetConsoleMode(handle, WithoutQuickEdit(mode)) || !GetConsoleMode(handle, out mode))
            {
                result.Error = Marshal.GetLastWin32Error();
                return result;
            }
            result.After = mode;
            result.Success = (mode & EnableQuickEdit) == 0 && (mode & EnableExtendedFlags) != 0;
            return result;
        }
        finally
        {
            if (owned != null) owned.Dispose();
        }
    }
}
'@

Add-Type -TypeDefinition $source
$result = [EscandonConsoleInputMode]::DisableQuickEditMode()
if ($PassThru) { $result | ConvertTo-Json -Compress }
if (-not $result.Success) {
    [Console]::Error.WriteLine('No fue posible verificar QuickEdit en esta consola. El registro del servidor permanece separado de la ventana.')
    exit 1
}
