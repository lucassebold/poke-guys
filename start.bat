@echo off
cd /d "%~dp0"
set NODE=node
if exist "D:\REA_tools\node-v24.18.0-win-x64\node.exe" set NODE="D:\REA_tools\node-v24.18.0-win-x64\node.exe"
start "" http://localhost:8765
%NODE% server.js
