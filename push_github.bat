@echo off
cd /d "%~dp0"
title story-director - commit + push to GitHub

echo ============================================
echo   story-director: auto commit + push main to GitHub
echo ============================================
git status -sb | findstr /b "##"

echo.
echo [1/2] Auto commit local changes...
git add -A
git diff --cached --quiet
if not %errorlevel%==0 goto docommit
echo   Nothing new to commit.
goto push1

:docommit
git commit -m "sync: auto commit"
if errorlevel 1 goto commitfail
goto push1

:commitfail
echo   Commit failed: check if files are locked by other programs.
pause
exit /b 1

:push1
echo.
echo [2/2] Push main to GitHub...
rem Credentials: Git Credential Manager by default; or put the token in
rem %%USERPROFILE%%\.github_token (first line only, created outside any repo).
set "GTOKEN="
if exist "%USERPROFILE%\.github_token" set /p GTOKEN=<"%USERPROFILE%\.github_token"
if defined GTOKEN (set "HOST=%GTOKEN%@github.com") else (set "HOST=github.com")

git -c http.version=HTTP/1.1 push https://%HOST%/abitfox/story-director.git main
if not errorlevel 1 goto done

echo   [retry 1/3] direct failed, trying 7897 proxy...
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 push https://%HOST%/abitfox/story-director.git main
if not errorlevel 1 goto done

echo   [retry 2/3] trying direct again...
git -c http.version=HTTP/1.1 push https://%HOST%/abitfox/story-director.git main
if not errorlevel 1 goto done

echo   [retry 3/3] trying 7897 proxy again...
git -c http.proxy=http://127.0.0.1:7897 -c http.version=HTTP/1.1 push https://%HOST%/abitfox/story-director.git main
if not errorlevel 1 goto done

echo.
echo   Push FAILED. Checklist:
echo     1) network / proxy (7897) running?
echo     2) token valid? update %USERPROFILE%\.github_token
echo     3) or run: git config credential.helper manager
pause
exit /b 1

:done
echo.
echo ============================================
git status -sb | findstr /b "##"
echo ============================================
echo Push OK.
pause
