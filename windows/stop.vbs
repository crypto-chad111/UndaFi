' Stops UndaFi. Whether it was ON or OFF is remembered for next time.
Option Explicit
Dim http, sh, port
' The shortcut starts the app on the port in the PORT setting of Windows, or
' 4780 when there is none. Use the same one here.
Set sh = CreateObject("WScript.Shell")
port = sh.ExpandEnvironmentStrings("%PORT%")
If port = "%PORT%" Or Not IsNumeric(port) Then port = "4780"
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.Open "POST", "http://localhost:" & port & "/api/quit", False
http.setRequestHeader "Content-Type", "application/json"
http.Send "{}"
If Err.Number <> 0 Then
  MsgBox "UndaFi does not seem to be running.", 64, "UndaFi"
ElseIf http.Status = 200 Then
  MsgBox "UndaFi has stopped. It is no longer watching.", 64, "UndaFi"
Else
  MsgBox "UndaFi did not stop (answer " & http.Status & ").", 48, "UndaFi"
End If
