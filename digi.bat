@echo off
REM change code page to UTF-8
chcp 65001

REM ============================================================================
REM MAIN
REM ============================================================================
if defined VPN_APP start "" %VPN_APP%

echo VPN kapcsolatra várok...

:wait_for_vpn
set connected=2
wmic nic get Name, NetConnectionStatus | findstr VPN | findstr %connected% > nul
if errorlevel 1 goto wait_for_vpn

REM call :sleep 5 "mp és indítom a servlet-et..."

start npm start

call :sleep 10 "mp és nyitom a csatorna listát..."

start channels_IPTV.m3u8

goto done


REM ============================================================================
REM sleep for _sleep_time seconds and echo the _msg beforehand
REM ============================================================================
:sleep
setlocal
    set _sleep_time=%1
    set _msg=%~2
    echo %_sleep_time% %_msg%
    ping 127.0.0.1 -n %_sleep_time% > nul
    exit /b 0
endlocal
REM ============================================================================

:done
