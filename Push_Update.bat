@echo off
setlocal

chcp 65001 >nul
cd /d "%~dp0config"
set ELECTRON_BUILDER_ALLOW_UNRESOLVED_LINKS=true
set DEBUG=electron-builder
set NPM_CMD=%ProgramFiles%\nodejs\npm.cmd
if not exist "%NPM_CMD%" set NPM_CMD=npm.cmd
set APP_VERSION=
set CURRENT_VERSION=
set NEW_VERSION=
set BUILD_TYPE=
set LOCK_FILE=%TEMP%\pilkos-publish.lock
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content package.json | ConvertFrom-Json).version"') do set CURRENT_VERSION=%%v
if "%CURRENT_VERSION%"=="" (
	echo Version read failed.
	exit /b 1
)
choice /c MNP /m "Select build type: [M]ajor, Mi[N]or, [P]atch"
if errorlevel 3 (
	set BUILD_TYPE=patch
) else if errorlevel 2 (
	set BUILD_TYPE=minor
) else (
	set BUILD_TYPE=major
)
for /f "delims=" %%v in ('powershell -NoProfile -Command "$v='%CURRENT_VERSION%'; $type='%BUILD_TYPE%'; $parts=$v.Split('.'); $major=[int]$parts[0]; $minor=[int]$parts[1]; $patch=[int]$parts[2]; switch ($type) { 'major' { $major++; $minor=0; $patch=0 } 'minor' { $minor++; $patch=0 } default { $patch++ } }; Write-Output \"$major.$minor.$patch\""') do set NEW_VERSION=%%v
if "%NEW_VERSION%"=="" (
	echo Version calculation failed.
	exit /b 1
)
echo Version update: v%CURRENT_VERSION% ^> v%NEW_VERSION%
choice /m "Ready to start the build"
if errorlevel 2 (
	echo Build canceled by user.
	exit /b 0
)
echo. > "%LOCK_FILE%"
start "" /b powershell -NoProfile -Command "$lock='%LOCK_FILE%'; $start=Get-Date; $bars=@('[----------]','[##--------]','[####------]','[######----]','[########--]','[##########]'); $i=0; while(Test-Path $lock){ $bar=$bars[$i %% $bars.Length]; $elapsed=[int]((Get-Date)-$start).TotalSeconds; $host.UI.RawUI.WindowTitle=\"Publishing $bar ${elapsed}s\"; Start-Sleep -Seconds 1; $i++ }"
powershell -NoProfile -Command "& '%NPM_CMD%' version %BUILD_TYPE% --no-git-tag-version"
if errorlevel 1 (
	echo Version bump failed.
	del "%LOCK_FILE%" >nul 2>nul
	exit /b 1
)
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content package.json | ConvertFrom-Json).version"') do set APP_VERSION=%%v
if "%APP_VERSION%"=="" (
	echo Version read failed.
	del "%LOCK_FILE%" >nul 2>nul
	exit /b 1
)
powershell -NoProfile -Command "if ('%APP_VERSION%' -ne '%NEW_VERSION%') { Write-Host 'Warning: package.json version does not match expected version.' }"
powershell -NoProfile -Command "& '%NPM_CMD%' run publish 2>&1 | ForEach-Object { $_ -replace 'ΓÇó\\s*','' -replace '•\\s*','' -replace '^[^\\x20-\\x7E]+' , '' } | Where-Object { $_ -match 'building|publishing|uploading|creating|ERROR|error|failed|✔|✓' }"
del "%LOCK_FILE%" >nul 2>nul
title PilkOS Publish
choice /m "Push packaged build to git (tag + origin main)?"
if errorlevel 2 (
	echo Git push skipped by user.
) else (
	git tag v%APP_VERSION%
	git push origin main
	git push origin v%APP_VERSION%
)
choice /m "Publish GitHub release now?"
if errorlevel 2 (
	echo Release publish skipped by user.
) else (
	set SKIP_RELEASE=
	where gh >nul 2>nul
	if errorlevel 1 (
		where winget >nul 2>nul
		if errorlevel 1 (
			echo GitHub CLI not found and winget is unavailable.
			echo Install GitHub CLI manually: https://cli.github.com/
			set SKIP_RELEASE=1
		)
		echo Installing GitHub CLI...
		winget install --id GitHub.cli -e --source winget
		if errorlevel 1 (
			echo GitHub CLI install failed. Install manually: https://cli.github.com/
			set SKIP_RELEASE=1
		)
	)
	if not defined SKIP_RELEASE (
		gh auth status >nul 2>nul
		if errorlevel 1 (
			echo GitHub CLI not logged in. Starting login...
			gh auth login
			if errorlevel 1 (
				echo GitHub CLI login failed. Skipping release publish.
				set SKIP_RELEASE=1
			)
		)
	)
	if not defined SKIP_RELEASE (
		set RELEASE_EXE=..\release\PilkOS v%APP_VERSION%.exe
		set RELEASE_BLOCKMAP=..\release\PilkOS v%APP_VERSION%.exe.blockmap
		set RELEASE_LATEST=..\release\latest.yml
		if not exist "%RELEASE_EXE%" (
			echo Release EXE not found: %RELEASE_EXE%
		) else (
			gh release create v%APP_VERSION% "%RELEASE_EXE%" "%RELEASE_BLOCKMAP%" "%RELEASE_LATEST%" --title "v%APP_VERSION%" --notes-file "..\docs\CHANGELOG.md"
		)
	)
)
echo.
echo Publish finished.
pause
