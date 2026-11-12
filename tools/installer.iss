; The Mockup Director installer, compiled by tools/installer.mjs (npm run installer) with Inno Setup 7
; (ISCC.exe) from the app that `npm run tauri build` leaves in src-tauri/target/release. It installs
; for the current user, with no administrator rights, into %LOCALAPPDATA%\Programs\Mockup Director,
; or, if the user chooses and is an administrator, for all users into Program Files. Either way each
; user's looks, settings, open tabs and log stay in their own %LOCALAPPDATA%\<identifier>.
;
; installer.mjs passes:
;   AppVersion      the release, e.g. 0.2.0 or 0.3.0-beta.1
;   NumericVersion  its four numbers for the Windows version resource, e.g. 0.2.0.0
;   Identifier      the app identifier (tauri.conf.json), which names the app's data folder
;   Publisher       the publisher (tauri.conf.json)
;   Copyright       the copyright line (tauri.conf.json)
;   OutputDir       where the installer is written

#if !Defined(AppVersion) || !Defined(NumericVersion) || !Defined(Identifier) || !Defined(Publisher) || !Defined(Copyright) || !Defined(OutputDir)
  #error Build the installer with npm run installer (tools/installer.mjs), which passes the values this script needs.
#endif

#define AppName "Mockup Director"
#define AppExe "mockup-director.exe"
#define Repository "https://github.com/Infinitinker/Mockup-Director"
#define AppGuid "5232673D-A21D-4A04-B4C4-6E8C5ACCFEDE"
#define Build "..\src-tauri\target\release"
; Double-clicking a .mdproj file opens it in Mockup Director (src-tauri/src/opened.rs reads the path).
#define ProjectExtension ".mdproj"
#define ProjectType "MockupDirector.Project"
; The Microsoft Edge WebView2 runtime: its registry entry and the bootstrapper that installs it.
#define WebView2Client "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
#define WebView2Bootstrapper "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

[Setup]
; Never change AppId: it is how an update finds the installed Mockup Director.
AppId={{{#AppGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#Publisher}
AppPublisherURL={#Repository}
AppSupportURL={#Repository}/issues
AppUpdatesURL={#Repository}/releases
AppCopyright={#Copyright}
VersionInfoVersion={#NumericVersion}
VersionInfoProductTextVersion={#AppVersion}
PrivilegesRequired=lowest
; Setup asks "for me only" or "for all users" (or takes /CURRENTUSER or /ALLUSERS), offering the
; previous choice on an update; {autopf}, {autoprograms}, {autodesktop} and HKA follow it.
PrivilegesRequiredOverridesAllowed=dialog commandline
SetupArchitecture=x64
MinVersion=10.0
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=MockupDirector-{#AppVersion}-windows-x64-setup
SetupIconFile=..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
ChangesAssociations=yes
; Setup and Uninstall ask the user to quit a running Mockup Director: the mutex is the one of Tauri's
; single-instance plugin (src-tauri/src/lib.rs), "<identifier>-sim". Setup then offers to close
; other programs that use its files, which a silent install closes without asking. Mockup Director
; is started again from the last page, not by Windows.
AppMutex={#Identifier}-sim
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
; FmtMessage fills in %1; %n is a line break.
ProjectFile=Mockup Director project
DeleteData=Also delete your Mockup Director looks, settings, open tabs and log? Your projects stay where you saved them.%n%n%1
DataNotDeleted=Some files in %1 could not be deleted. Delete the folder yourself.
WebView2Title=Microsoft Edge WebView2
WebView2Text=Mockup Director needs Microsoft Edge WebView2, which this computer does not have yet. Setup downloads and installs it.
WebView2ExitCode=the WebView2 installer stopped with code %1
WebView2Failed=Microsoft Edge WebView2 could not be installed: %1%n%nCheck the internet connection and click Install again, or install WebView2 from https://developer.microsoft.com/microsoft-edge/webview2 and then run Setup again.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; A GNU build loads WebView2Loader.dll at run time, so it goes next to the app; the license texts
; come with every copy. Inno Setup fails on a missing file, so a build without one never ships.
Source: "{#Build}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Build}\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Build}\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Build}\THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; Uninstall removes these, but leaves .mdproj to another program that has registered it too: the
; extension's default value only while it is still Mockup Director's (CurUninstallStepChanged).
Root: HKA; Subkey: "Software\Classes\{#ProjectExtension}"; ValueType: string; ValueName: ""; ValueData: "{#ProjectType}"; Flags: uninsdeletekeyifempty
Root: HKA; Subkey: "Software\Classes\{#ProjectExtension}\OpenWithProgids"; ValueType: string; ValueName: "{#ProjectType}"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKA; Subkey: "Software\Classes\{#ProjectType}"; ValueType: string; ValueName: ""; ValueData: "{cm:ProjectFile}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\{#ProjectType}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\{#ProjectType}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: "{#ProjectExtension}"; ValueData: ""

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; As the user who ran Setup, not as the administrator an all-users install runs as: Mockup Director
; keeps that user's looks and open tabs.
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
var
  WebView2Page: TDownloadWizardPage;

// WebView2 comes with Windows 11 and an up-to-date Windows 10. It is installed for all users
// (registered in the 32-bit view of HKLM) or for the current user (HKCU).
function HasWebView2: Boolean;
var
  Version: String;
begin
  Result := (RegQueryStringValue(HKLM32, '{#WebView2Client}', 'pv', Version) or
             RegQueryStringValue(HKCU, '{#WebView2Client}', 'pv', Version)) and
            (Version <> '') and (Version <> '0.0.0.0');
end;

procedure InitializeWizard;
begin
  WebView2Page := CreateDownloadPage(CustomMessage('WebView2Title'), CustomMessage('WebView2Text'), nil);
  WebView2Page.ShowBaseNameInsteadOfUrl := True;
end;

// Downloads Microsoft's bootstrapper and lets it install WebView2. Returns '' or what went wrong.
function InstallWebView2: String;
var
  Bootstrapper: String;
  ResultCode: Integer;
begin
  Result := '';
  WebView2Page.Clear;
  WebView2Page.Add('{#WebView2Bootstrapper}', 'MicrosoftEdgeWebview2Setup.exe', '');
  WebView2Page.Show;
  try
    try
      WebView2Page.Download;
      Bootstrapper := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
      if not Exec(Bootstrapper, '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
        Result := SysErrorMessage(ResultCode)
      else if not HasWebView2 then
        Result := FmtMessage(CustomMessage('WebView2ExitCode'), [IntToStr(ResultCode)]);
    except
      Result := GetExceptionMessage;
    end;
  finally
    WebView2Page.Hide;
  end;
end;

// Before installing (also in a silent install, where Setup goes through the pages on its own), so a
// failure leaves nothing half installed: the user stays on the last page and can try again.
function NextButtonClick(CurPageID: Integer): Boolean;
var
  Error: String;
begin
  Result := True;
  if (CurPageID = wpReady) and not HasWebView2 then
  begin
    Error := InstallWebView2;
    if Error <> '' then
    begin
      SuppressibleMsgBox(FmtMessage(CustomMessage('WebView2Failed'), [Error]), mbCriticalError, MB_OK, IDOK);
      Result := False;
    end;
  end;
end;

// Before the [Registry] entries are removed, so .mdproj's key goes too once it is empty.
procedure RemoveProjectDefault;
var
  ProgId: String;
begin
  if RegQueryStringValue(HKA, 'Software\Classes\{#ProjectExtension}', '', ProgId) and (ProgId = '{#ProjectType}') then
    RegDeleteValue(HKA, 'Software\Classes\{#ProjectExtension}', '');
end;

// The uninstaller removes the program folder; the user's own data is removed only if they say so,
// and only for an install of their own: an all-users uninstall runs as an administrator, whose
// folder may not be the one of the user who asked, and leaves each user's data alone.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  UserData: String;
begin
  if CurUninstallStep = usUninstall then
    RemoveProjectDefault;
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent and not IsAdminInstallMode then
  begin
    UserData := ExpandConstant('{localappdata}\{#Identifier}');
    if DirExists(UserData) and
       (MsgBox(FmtMessage(CustomMessage('DeleteData'), [UserData]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) and
       not DelTree(UserData, True, True, True) then
      MsgBox(FmtMessage(CustomMessage('DataNotDeleted'), [UserData]), mbError, MB_OK);
  end;
end;
