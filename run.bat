@echo off
REM change code page to UTF-8
chcp 65001

REM ============================================================================
REM MAIN
REM ============================================================================

REM Constantly retry; never give up!
:retry
node main.js
goto retry
