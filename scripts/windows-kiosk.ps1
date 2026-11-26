param([ValidateRange(1,65535)][int]$Port = 5193, [int]$ServerProcessId = 0)
$ErrorActionPreference = 'Stop'
if ([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) { throw 'Start the server in the signed-in exhibition desktop session.' }
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$chrome) { throw 'Google Chrome is not installed.' }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class WhistleWindows {
    delegate bool EnumProc(IntPtr window, IntPtr data);
    [DllImport("user32")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder title, int size);
    [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32")] static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
    [DllImport("user32")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }

    public static IntPtr Find(string title) {
        var result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr handle, IntPtr unused) {
            if (!IsWindowVisible(handle)) return true;
            var text = new StringBuilder(256);
            GetWindowText(handle, text, text.Capacity);
            if (text.ToString() != title && text.ToString() != title + " - Google Chrome" && text.ToString() != title + " - Chrome") return true;
            int pid;
            GetWindowThreadProcessId(handle, out pid);
            try { if (Process.GetProcessById(pid).ProcessName != "chrome") return true; }
            catch (ArgumentException) { return true; }
            result = handle;
            return false;
        }, IntPtr.Zero);
        return result;
    }
    public static Rectangle Bounds(IntPtr window) {
        Rect r;
        GetWindowRect(window, out r);
        return Rectangle.FromLTRB(r.left,r.top,r.right,r.bottom);
    }
    public static void Place(IntPtr window, Rectangle area) {
        ShowWindow(window, 9);
        SetWindowPos(window, IntPtr.Zero, area.X+12, area.Y+12, area.Width-24, area.Height-24, 0x14);
    }
    public static void FullscreenKey(IntPtr window) {
        PostMessage(window, 0x100, (IntPtr)0x7A, (IntPtr)0x00570001);
        PostMessage(window, 0x101, (IntPtr)0x7A, new IntPtr(unchecked((int)0xC0570001)));
    }
    public static void Close(IntPtr window) { PostMessage(window, 0x10, IntPtr.Zero, IntPtr.Zero); }
}
'@
[void][WhistleWindows]::SetThreadDpiAwarenessContext([IntPtr](-4))

function Show-Channel($Channel, $Title, $Screen) {
    $handle = [WhistleWindows]::Find($Title)
    if ($handle -eq [IntPtr]::Zero) {
        Start-Process $chrome -ArgumentList "--no-first-run --app=http://127.0.0.1:$Port/whistle/kiosk/?channel=$Channel"
        for ($i=0; $i -lt 80 -and $handle -eq [IntPtr]::Zero; $i++) {
            Start-Sleep -Milliseconds 250
            $handle = [WhistleWindows]::Find($Title)
        }
    }
    if ($handle -eq [IntPtr]::Zero) { throw "Chrome did not open $Title" }
    $bounds = [WhistleWindows]::Bounds($handle)
    if ($bounds -eq $Screen.Bounds) { return }
    if ($bounds -eq [Windows.Forms.Screen]::FromHandle($handle).Bounds) {
        [WhistleWindows]::FullscreenKey($handle)
        Start-Sleep -Milliseconds 450
    }
    [WhistleWindows]::Place($handle, $Screen.Bounds)
    Start-Sleep -Milliseconds 200
    [WhistleWindows]::FullscreenKey($handle)
    for ($i=0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 150
        if ([WhistleWindows]::Bounds($handle) -eq $Screen.Bounds) { return }
    }
    throw "Chrome did not fill $($Screen.DeviceName) for $Title"
}

$lastLayout = ''
$server = if ($ServerProcessId) { Get-Process -Id $ServerProcessId }
do {
    $screens = @([Windows.Forms.Screen]::AllScreens | Sort-Object @{Expression='Primary';Descending=$true},DeviceName)
    $layout = ($screens | ForEach-Object { "$($_.DeviceName) $($_.Bounds)" }) -join ';'
    if ($layout -ne $lastLayout) {
        Show-Channel 'editor' 'Whistle Kiosk - Editor' $screens[0]
        if ($screens.Count -gt 1) { Show-Channel 'scene' 'Whistle Kiosk - 3D' $screens[1] }
        else {
            $scene = [WhistleWindows]::Find('Whistle Kiosk - 3D')
            if ($scene -ne [IntPtr]::Zero) { [WhistleWindows]::Close($scene) }
        }
        Write-Output "Whistle kiosk layout: $layout"
        $lastLayout = $layout
    }
    if ($null -eq $server) { break }
    Start-Sleep -Seconds 3
    [Windows.Forms.Application]::DoEvents()
} while (!$server.HasExited)
