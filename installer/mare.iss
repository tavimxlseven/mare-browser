#ifndef MareVersion
#define MareVersion "0.3.8"
#endif
#ifndef Payload
#define Payload "..\dist\InstallerPayload"
#endif
[Setup]
AppId={{986F3E86-C55B-4E42-9FE0-89588FB4A251}
AppName=Maré Browser
AppVersion={#MareVersion}
AppPublisher=Maré Browser contributors
AppPublisherURL=https://github.com/tavimxlseven/mare-browser
AppSupportURL=https://github.com/tavimxlseven/mare-browser/issues
DefaultDirName={localappdata}\Programs\Mare
DefaultGroupName=Maré Browser
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
[Files]
Source: "{#Payload}\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Payload}\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy
[Icons]
Name: "{group}\Maré Browser"; Filename: "{app}\Mare.exe"; WorkingDir: "{app}"; AppUserModelID: "Mare.Browser"
Name: "{autodesktop}\Maré Browser"; Filename: "{app}\Mare.exe"; WorkingDir: "{app}"; AppUserModelID: "Mare.Browser"; Tasks: desktopicon
[Run]
Filename: "{app}\Mare.exe"; Description: "Abrir Maré Browser"; Flags: nowait postinstall skipifsilent
[Code]
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
