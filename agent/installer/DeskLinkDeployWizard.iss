#define PayloadDir "..\\installer\\payload"
#define OutputDir "..\\installer\\publish"
#define OutputName "DeskLinkDeployWizard"

[Setup]
AppId={{2E709A0A-285A-4C3D-8F0B-31A8C6A98485}
AppName=DeskLink Host
AppVersion=1.0.0
AppPublisher=DeskLink
DefaultDirName={localappdata}\DeskLinkHost
AppendDefaultDirName=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardResizable=no
Uninstallable=no
DisableReadyPage=no
DisableReadyMemo=no
SetupIconFile=..\build\icon.ico
ShowLanguageDialog=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\DeskLink Host"; Filename: "{app}\DeskLinkHost.exe"; WorkingDir: "{app}"; IconFilename: "{app}\icon.ico"; Check: not DesktopShortcutExists

[Run]
Filename: "{app}\DeskLinkHost.exe"; Description: "Iniciar o DeskLink Host agora"; Flags: nowait postinstall skipifsilent

[Messages]
DirExistsTitle=Diretório já existente
DirExists=O diretório: %1 já existe. Gostaria de continuar e sobrescrever os arquivos?
StatusExtractFiles=Extraindo arquivos da aplicação...

[Code]
procedure ApplyProfessionalUiTexts;
begin
  WizardForm.Caption := 'DeskLink Host - Assistente de Instalação';
  WizardForm.WelcomeLabel1.Caption := 'Bem-vindo ao Assistente de Instalação do DeskLink Host';
  WizardForm.WelcomeLabel2.Caption :=
    'Este assistente irá instalar ou atualizar o DeskLink Host no computador.' + #13#10 +
    'Para continuar, clique em "Avançar".';
  WizardForm.SelectDirLabel.Caption :=
    'Utilize "Selecionar..." para escolher outro diretório ou clique em "Avançar" para prosseguir.';
  WizardForm.SelectDirBrowseLabel.Caption := '';
  WizardForm.DiskSpaceLabel.Caption :=
    'É necessário, no mínimo, 276,6 MB de espaço livre em disco.';
  WizardForm.DirBrowseButton.Caption := '&Selecionar...';
  WizardForm.ReadyLabel.Caption :=
    'Revise as informações abaixo antes de iniciar a instalação. Clique em "Instalar" para prosseguir ou em "Voltar" para realizar alterações.';
  WizardForm.FinishedHeadingLabel.Caption := 'Instalação concluída';
  WizardForm.FinishedLabel.Caption :=
    'A instalação do DeskLink Host foi concluída com sucesso.' + #13#10 +
    'Utilize o atalho criado na Área de Trabalho para iniciar o aplicativo.';
  WizardForm.NextButton.Caption := '&Avançar >';
  WizardForm.BackButton.Caption := '< &Voltar';
  WizardForm.CancelButton.Caption := '&Cancelar';
end;

function DesktopShortcutExists: Boolean;
begin
  Result := FileExists(ExpandConstant('{autodesktop}\DeskLink Host.lnk'));
end;

function TryGetShortcutTargetDir(var InstallDir: string): Boolean;
var
  ShortcutPath: string;
  TargetPath: string;
  WshShell: Variant;
  Shortcut: Variant;
begin
  Result := False;
  InstallDir := '';
  ShortcutPath := ExpandConstant('{autodesktop}\DeskLink Host.lnk');
  if not FileExists(ShortcutPath) then
    Exit;
  try
    WshShell := CreateOleObject('WScript.Shell');
    Shortcut := WshShell.CreateShortcut(ShortcutPath);
    TargetPath := Shortcut.TargetPath;
    if (TargetPath <> '') and FileExists(TargetPath) then
    begin
      InstallDir := ExtractFileDir(TargetPath);
      Result := InstallDir <> '';
    end;
  except
    Result := False;
  end;
end;

procedure InitializeWizard;
var
  ExistingDir: string;
begin
  ApplyProfessionalUiTexts;
  if TryGetShortcutTargetDir(ExistingDir) then
    WizardForm.DirEdit.Text := ExistingDir;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  // O Inno pode reatribuir alguns textos internamente ao mudar de página.
  // Reaplicamos para manter o padrão profissional consistente.
  ApplyProfessionalUiTexts;
  if CurPageID = wpSelectDir then
  begin
    WizardForm.PageNameLabel.Caption := 'Diretório de Instalação';
    WizardForm.PageDescriptionLabel.Caption :=
      'Defina o diretório onde o DeskLink Host será instalado e onde serão descompactados os arquivos da aplicação e suas dependências.';
  end;
  if CurPageID = wpReady then
  begin
    WizardForm.PageNameLabel.Caption := 'Pronto para Instalação';
    WizardForm.PageDescriptionLabel.Caption :=
      'O instalador está pronto para iniciar a instalação do DeskLink Host neste computador.';
    WizardForm.ReadyMemo.Lines.Text :=
      'Diretório de instalação:' + #13#10 +
      WizardForm.DirEdit.Text + #13#10 + #13#10 +
      'Componentes:' + #13#10 +
      '- DeskLink Host' + #13#10 +
      '- Dependências' + #13#10 + #13#10 +
      'Espaço em disco necessário:' + #13#10 +
      '276,6 MB';
  end;
  if CurPageID = wpInstalling then
  begin
    WizardForm.PageNameLabel.Caption := 'Instalação em andamento';
    WizardForm.PageDescriptionLabel.Caption :=
      'Aguarde enquanto o DeskLink Host está sendo instalado neste computador.';
  end;
  if CurPageID = wpFinished then
    WizardForm.NextButton.Caption := '&Fechar';
end;
