Set WshShell = CreateObject("WScript.Shell")
' Creamos la carpeta C:\HospitalAPI si no existe, y luego lanzamos el túnel redirigiendo el texto ahí
WshShell.Run "cmd.exe /c ""mkdir C:\HospitalAPI 2>nul & %TEMP%\bore\bore.exe local 1433 --to bore.pub > C:\HospitalAPI\puerto_tunel.txt 2>&1""", 0

MsgBox "El túnel se está ejecutando de fondo de forma invisible." & vbCrLf & vbCrLf & "Revisa el archivo 'puerto_tunel.txt' que aparecerá en la carpeta C:\HospitalAPI en unos segundos para ver qué puerto te asignó.", 64, "Túnel Activo"
