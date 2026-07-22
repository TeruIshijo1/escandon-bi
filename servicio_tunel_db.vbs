Dim WshShell, fso, tempFolder, boreExe
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
tempFolder = WshShell.ExpandEnvironmentStrings("%TEMP%")
boreExe = tempFolder & "\bore\bore.exe"

' Descargar la herramienta de red si no existe en el equipo
If Not fso.FileExists(boreExe) Then
    WshShell.Run "powershell -WindowStyle Hidden -Command ""Invoke-WebRequest -Uri 'https://github.com/ekzhang/bore/releases/download/v0.5.1/bore-v0.5.1-x86_64-pc-windows-msvc.zip' -OutFile '%TEMP%\bore.zip'; Expand-Archive -Path '%TEMP%\bore.zip' -DestinationPath '%TEMP%\bore' -Force""", 0, True
End If

' Lanzar el túnel redirigiendo la salida a un archivo para que el usuario pueda ver el puerto
WshShell.Run "cmd.exe /c ""mkdir C:\HospitalAPI 2>nul & %TEMP%\bore\bore.exe local 1433 --to bore.pub > C:\HospitalAPI\puerto_tunel.txt 2>&1""", 0, False

' Notificar al usuario
Dim mensaje
mensaje = "El servicio de conexión remota (Túnel DB) se ha iniciado en segundo plano correctamente." & vbCrLf & vbCrLf
mensaje = mensaje & "Como no hay pantalla visible, el puerto asignado se guardará en un archivo de texto." & vbCrLf & vbCrLf
mensaje = mensaje & "Por favor, espere 5 segundos, abra el archivo:" & vbCrLf
mensaje = mensaje & "C:\HospitalAPI\puerto_tunel.txt" & vbCrLf & vbCrLf
mensaje = mensaje & "Y utilice el puerto indicado para actualizar la variable REMOTE_DB_PORT en su archivo .env"

MsgBox mensaje, 64, "Hospital Escandón - Servicio Remoto"
