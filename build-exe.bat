@echo off
echo ========================================================
echo   Kompilyatsiya: ecommerce-api.exe (C# to Native Windows EXE)
echo ========================================================

set CSC="C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if not exist %CSC% (
    echo Xatolik: csc.exe topilmadi.
    exit /b 1
)

%CSC% /target:exe /out:ecommerce-api.exe /platform:anycpu /optimize+ Program.cs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo   MUOFFAQIYATLI: ecommerce-api.exe yaratildi!
    echo   Endi ushbu .exe faylni ikki marta bosib ishga tushirishingiz mumkin.
    echo ========================================================
) else (
    echo.
    echo Kompilyatsiyada xatolik yuz berdi.
    exit /b %ERRORLEVEL%
)
