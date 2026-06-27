Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\Anilab"
WshShell.Run "cmd.exe /c npm run dev", 0, false
