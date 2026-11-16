@echo off
rem Opens OpenStage Author with the Presenter add-on switched on.
rem The add-on is not signed yet, so the editor shows Insert, Presenter only while OPENSTAGE_DEV_ADDONS is 1.
rem The setting lasts only until this window closes.
set "OPENSTAGE_DEV_ADDONS=1"
call "%~dp0..\OPEN EDITOR.bat"
