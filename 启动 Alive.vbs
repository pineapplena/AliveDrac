Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
script = root & "\start-alive.bat"
shell.Run "cmd.exe /c """ & script & """", 0, False
