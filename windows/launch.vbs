' Starts UndaFi without a black window, then opens the dashboard.
' If UndaFi is already running, it only opens the dashboard.
' Run with the word "quiet" to start it without opening the dashboard.
Option Explicit
Dim sh, fso, root, extra
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")
extra = " --open"
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "quiet" Then extra = ""
End If
' 0 = hidden window. What the app prints goes to data\undafi.log.
sh.Run "cmd /c node server.js" & extra & " >> ""data\undafi.log"" 2>&1", 0, False
