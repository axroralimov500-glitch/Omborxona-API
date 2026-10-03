@echo off
title Elektron Savdo va Ombor API
if exist ecommerce-api.exe (
    start ecommerce-api.exe
) else (
    node src\server.js
)
