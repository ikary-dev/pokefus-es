@echo off
setlocal
chcp 65001 >nul
title Quitar la traduccion  -  Traducido por: ikary

rem Devuelve el cliente a su estado original a partir de las copias que se
rem guardaron la primera vez que se aplico.

cd /d "%~dp0"

set "JUEGO="
for %%C in (
  "%~dp0..\Pokefus UpLauncher"
  "%~dp0..\..\Pokefus UpLauncher"
  "%USERPROFILE%\Desktop\Pokefus\Pokefus UpLauncher"
  "%USERPROFILE%\Escritorio\Pokefus\Pokefus UpLauncher"
  "%USERPROFILE%\Desktop\Pokefus UpLauncher"
  "%USERPROFILE%\Pokefus UpLauncher"
  "%LOCALAPPDATA%\Pokefus UpLauncher"
  "C:\Pokefus UpLauncher"
) do if not defined JUEGO if exist "%%~C\client\Dofus Retro.exe" set "JUEGO=%%~C"

if not defined JUEGO (
  echo  No encuentro Pokefus.
  pause
  exit /b 1
)

set ELECTRON_RUN_AS_NODE=1
"%JUEGO%\client\Dofus Retro.exe" "%~dp0aplicar.js" quitar
set ELECTRON_RUN_AS_NODE=

echo.
pause
