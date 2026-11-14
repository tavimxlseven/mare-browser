#ifndef MareVersion
#define MareVersion "0.5.8"
#endif
#ifndef Payload
#define Payload "..\dist\InstallerPayload"
#endif
[Setup]
AppId={{986F3E86-C55B-4E42-9FE0-89588FB4A251}
AppName=Compass Browser
AppVersion={#MareVersion}
AppPublisher=Compass Browser contributors
AppPublisherURL=https://github.com/tavimxlseven/mare-browser
AppSupportURL=https://github.com/tavimxlseven/mare-browser/issues
DefaultDirName={localappdata}\Programs\Mare
DefaultGroupName=Compass Browser
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\dist\Release
OutputBaseFilename=Mare-Setup-{#MareVersion}-x64
SetupIconFile={#Payload}\mare.ico
UninstallDisplayIcon={app}\Mare.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no
LicenseFile=..\LICENSE
[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"
Name: "importlegacyprofile"; Description: "Importar meu perfil antigo de D:\MareBrowserData para este usuário do Windows (inclui histórico e sessões)"; Flags: unchecked; Check: CanImportLegacyProfile
[Files]
Source: "{#Payload}\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Payload}\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy
[Icons]
Name: "{group}\Compass Browser"; Filename: "{app}\Mare.exe"; WorkingDir: "{app}"; AppUserModelID: "Mare.Browser"
Name: "{autodesktop}\Compass Browser"; Filename: "{app}\Mare.exe"; WorkingDir: "{app}"; AppUserModelID: "Mare.Browser"; Tasks: desktopicon
[Run]
Filename: "{app}\Mare.exe"; Description: "Abrir Compass Browser"; Flags: nowait postinstall skipifsilent
Filename: "{app}\Mare.exe"; Flags: nowait; Check: IsMareUpdate
[Code]
function CanImportLegacyProfile: Boolean;
begin
  Result := FileExists('D:\MareBrowserData\state.json') and not DirExists(ExpandConstant('{localappdata}\MareBrowser\User Data'));
end;
procedure CurStepChanged(CurStep: TSetupStep);
var ExitCode: Integer;
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('importlegacyprofile') then begin
    if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\import-profile.ps1') + '" -From "D:\MareBrowserData"', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) or (ExitCode <> 0) then
      MsgBox('Não foi possível importar o perfil. Nenhum dado original foi apagado. Feche todas as janelas do Compass e execute import-profile.ps1 na pasta do programa.', mbInformation, MB_OK);
  end;
end;
function IsMareUpdate: Boolean;
begin
  Result := ExpandConstant('{param:MAREUPDATE|0}') = '1';
end;
function HasWebView2: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKCU32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
var ExitCode: Integer;
begin
  Result := '';
  if HasWebView2 then exit;
  WizardForm.StatusLabel.Caption := 'Instalando Microsoft Edge WebView2 Runtime…';
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
    Result := 'Não foi possível iniciar a instalação do WebView2. Verifique sua conexão e execute este instalador novamente.';
    exit;
  end;
  if ExitCode = 3010 then NeedsRestart := True;
  if not HasWebView2 then Result := 'O WebView2 não ficou disponível (código ' + IntToStr(ExitCode) + '). Verifique sua conexão e execute este instalador novamente.';
end;
