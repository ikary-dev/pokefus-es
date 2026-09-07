@echo off
setlocal
chcp 65001 >nul
title Pokefus en espanol  -  Traducido por: ikary

rem ---------------------------------------------------------------------------
rem  Aplica la traduccion y arranca el juego.
rem
rem  Se usa el Electron que el propio juego trae como interprete, con la
rem  variable ELECTRON_RUN_AS_NODE: asi no hay que instalar Node ni nada.
rem
rem  Arrancar SIEMPRE desde aqui es lo que hace que la traduccion sobreviva a
rem  las actualizaciones. El actualizador de Pokefus restaura los archivos que
rem  tocamos dentro de la instalacion, y este arranque los vuelve a poner antes
rem  de abrir el juego. Volver a aplicar cuando ya esta aplicado no cuesta nada
rem  ni estropea nada.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

rem Localizar el juego. Lo hace instalacion.js, pero aqui hace falta el .exe
rem para poder ejecutar nada, asi que se busca lo mismo a mano.
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
  echo.
  echo  No encuentro Pokefus.
  echo.
  echo  Pon esta carpeta al lado de la carpeta del juego
  echo  ^(la que se llama "Pokefus UpLauncher"^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

set "NODE=%JUEGO%\client\Dofus Retro.exe"
set ELECTRON_RUN_AS_NODE=1

echo.
echo  Pokefus en espanol  -  Traducido por: ikary
echo.
echo  Aplicando la traduccion...
echo.
"%NODE%" "%~dp0aplicar.js"
if errorlevel 1 (
  echo.
  echo  Algo ha fallado. El juego se abre igual, en frances.
  echo.
  pause
)

set ELECTRON_RUN_AS_NODE=
echo.
echo  Abriendo Pokefus...
start "" "%JUEGO%\client\Dofus Retro.exe"
