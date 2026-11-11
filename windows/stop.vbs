' Stops UndaFi. Whether it was ON or OFF is remembered for next time.
Option Explicit
Dim http
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.Open "POST", "http://localhost:4780/api/quit", False
http.setRequestHeader "Content-Type", "application/json"
http.Send "{}"
If Err.Number <> 0 Then
  MsgBox "UndaFi does not seem to be running.", 64, "UndaFi"
ElseIf http.Status = 200 Then
  MsgBox "UndaFi has stopped. It is no longer watching.", 64, "UndaFi"
Else
  MsgBox "UndaFi did not stop (answer " & http.Status & ").", 48, "UndaFi"
End If
