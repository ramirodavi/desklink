#define PayloadCommonDir "payload-common"
#define PayloadHostDir "payload"
#define PayloadServerDir "payload-server"
#define OutputDir "publish"
#define OutputName "DeskLinkDeployWizard"

[Setup]
AppId={{2E709A0A-285A-4C3D-8F0B-31A8C6A98485}
AppName=DeskLink
AppVersion=1.0.0
AppPublisher=DeskLink
DefaultDirName={code:GetDefaultDir}
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
; Runtime Electron comum — instalado independente do papel escolhido (DLLs, pak, locales…)
Source: "{#PayloadCommonDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Host — exe, icon.ico e resources/ específicos do Host
Source: "{#PayloadHostDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: IsHostSelected

; Servidor — exe, icon.ico e resources/ específicos do Servidor
Source: "{#PayloadServerDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: IsServerSelected

[Icons]
Name: "{autodesktop}\DeskLink Host";     Filename: "{app}\DeskLinkHost.exe";   WorkingDir: "{app}"; IconFilename: "{app}\DeskLinkHost.exe";   IconIndex: 0; Check: IsHostSelected   and not HostDesktopShortcutExists
Name: "{autodesktop}\DeskLink Server"; Filename: "{app}\DeskLinkServer.exe"; WorkingDir: "{app}"; IconFilename: "{app}\DeskLinkServer.exe"; IconIndex: 0; Check: IsServerSelected and not ServerDesktopShortcutExists

[Run]
Filename: "{app}\DeskLinkHost.exe";   Description: "Iniciar o DeskLink Host agora";     Flags: nowait postinstall skipifsilent; Check: IsHostSelected
Filename: "{app}\DeskLinkServer.exe"; Description: "Iniciar o DeskLink Server agora"; Flags: nowait postinstall skipifsilent; Check: IsServerSelected

[Messages]
DirExistsTitle=Diretório já existente
DirExists=O diretório: %1 já existe. Gostaria de continuar e sobrescrever os arquivos?
StatusExtractFiles=Extraindo arquivos da aplicação...

[Code]

{ =========================================================================
  Variáveis globais
  ========================================================================= }

var
  RolePage: TWizardPage;
  RoleHostRadio:    TNewRadioButton;
  RoleServerRadio:  TNewRadioButton;
  DetectedHostDir:   string;   { diretório detectado de instalação anterior do Host   }
  DetectedServerDir: string;   { diretório detectado de instalação anterior do Servidor }

{ =========================================================================
  Utilitários gerais
  ========================================================================= }

{ IfThen não existe no Pascal do Inno Setup — declaramos aqui. }
function IfStr(Cond: Boolean; const A, B: string): string;
begin
  if Cond then Result := A else Result := B;
end;

{ =========================================================================
  Helpers de seleção de papel
  ========================================================================= }

function IsHostSelected: Boolean;
begin
  Result := (RoleHostRadio <> nil) and RoleHostRadio.Checked;
end;

function IsServerSelected: Boolean;
begin
  Result := (RoleServerRadio <> nil) and RoleServerRadio.Checked;
end;

{ Diretório padrão conforme seleção — usa dir detectado quando disponível }
function GetDefaultDir(Param: string): string;
begin
  if IsServerSelected then
  begin
    if DetectedServerDir <> '' then
      Result := DetectedServerDir
    else
      Result := ExpandConstant('{localappdata}\DeskLinkServer');
  end
  else
  begin
    if DetectedHostDir <> '' then
      Result := DetectedHostDir
    else
      Result := ExpandConstant('{localappdata}\DeskLinkHost');
  end;
end;

{ =========================================================================
  Detecção de atalhos existentes
  ========================================================================= }

function HostDesktopShortcutExists: Boolean;
begin
  Result := FileExists(ExpandConstant('{autodesktop}\DeskLink Host.lnk'));
end;

function ServerDesktopShortcutExists: Boolean;
begin
  Result := FileExists(ExpandConstant('{autodesktop}\DeskLink Server.lnk'));
end;

function TryGetShortcutTargetDir(const ShortcutName: string; var InstallDir: string): Boolean;
var
  ShortcutPath: string;
  TargetPath:   string;
  WshShell:     Variant;
  Shortcut:     Variant;
begin
  Result := False;
  InstallDir := '';
  ShortcutPath := ExpandConstant('{autodesktop}\') + ShortcutName + '.lnk';
  if not FileExists(ShortcutPath) then
    Exit;
  try
    WshShell := CreateOleObject('WScript.Shell');
    Shortcut := WshShell.CreateShortcut(ShortcutPath);
    TargetPath := Shortcut.TargetPath;
    if (TargetPath <> '') and FileExists(TargetPath) then
    begin
      InstallDir := ExtractFileDir(TargetPath);
      Result     := InstallDir <> '';
    end;
  except
    Result := False;
  end;
end;

{ =========================================================================
  Callback: mudança de papel → atualiza diretório sugerido
  ========================================================================= }

procedure RoleChanged(Sender: TObject);
begin
  if IsServerSelected then
  begin
    if DetectedServerDir <> '' then
      WizardForm.DirEdit.Text := DetectedServerDir
    else
      WizardForm.DirEdit.Text := ExpandConstant('{localappdata}\DeskLinkServer');
  end
  else
  begin
    if DetectedHostDir <> '' then
      WizardForm.DirEdit.Text := DetectedHostDir
    else
      WizardForm.DirEdit.Text := ExpandConstant('{localappdata}\DeskLinkHost');
  end;
end;

{ =========================================================================
  Criação da página de seleção de papel
  ========================================================================= }

procedure CreateRolePage;
var
  LblHost:   TNewStaticText;
  LblServer: TNewStaticText;
begin
  RolePage := CreateCustomPage(
    wpWelcome,
    'Tipo de instalação',
    'Selecione o papel que este computador irá desempenhar.'
  );

  { --- DeskLink Host --- }
  RoleHostRadio := TNewRadioButton.Create(RolePage);
  RoleHostRadio.Parent  := RolePage.Surface;
  RoleHostRadio.Left    := 0;
  RoleHostRadio.Top     := 12;
  RoleHostRadio.Width   := RolePage.SurfaceWidth;
  RoleHostRadio.Height  := 20;
  RoleHostRadio.Caption := 'DeskLink Host  —  compartilhar tela';
  RoleHostRadio.Checked := True;
  RoleHostRadio.OnClick := @RoleChanged;

  LblHost := TNewStaticText.Create(RolePage);
  LblHost.Parent   := RolePage.Surface;
  LblHost.Left     := 20;
  LblHost.Top      := RoleHostRadio.Top + RoleHostRadio.Height + 4;
  LblHost.Width    := RolePage.SurfaceWidth - 24;
  LblHost.Height   := 44;
  LblHost.AutoSize := False;
  LblHost.WordWrap := True;
  LblHost.Caption  :=
    'Instala o DeskLink Host no computador que irá compartilhar a tela ' +
    'remotamente. Requer um DeskLink Server acessível (local ou via túnel).';

  { --- DeskLink Server --- }
  RoleServerRadio := TNewRadioButton.Create(RolePage);
  RoleServerRadio.Parent  := RolePage.Surface;
  RoleServerRadio.Left    := 0;
  RoleServerRadio.Top     := LblHost.Top + LblHost.Height + 16;
  RoleServerRadio.Width   := RolePage.SurfaceWidth;
  RoleServerRadio.Height  := 20;
  RoleServerRadio.Caption := 'DeskLink Server  —  servidor de sinalização + túnel Cloudflare';
  RoleServerRadio.Checked := False;
  RoleServerRadio.OnClick := @RoleChanged;

  LblServer := TNewStaticText.Create(RolePage);
  LblServer.Parent   := RolePage.Surface;
  LblServer.Left     := 20;
  LblServer.Top      := RoleServerRadio.Top + RoleServerRadio.Height + 4;
  LblServer.Width    := RolePage.SurfaceWidth - 24;
  LblServer.Height   := 52;
  LblServer.AutoSize := False;
  LblServer.WordWrap := True;
  LblServer.Caption  :=
    'Instala o DeskLink Server, que inicializa o servidor de sinalização ' +
    'WebRTC e gerencia o túnel Cloudflare. Ao iniciar, a URL do túnel é ' +
    'exibida com botão de cópia e o navegador é aberto automaticamente.';
end;

{ =========================================================================
  Textos profissionais do wizard
  ========================================================================= }

procedure ApplyProfessionalUiTexts;
begin
  WizardForm.Caption := 'DeskLink - Assistente de Instalação';
  WizardForm.WelcomeLabel1.Caption := 'Bem-vindo ao Assistente de Instalação do DeskLink';
  WizardForm.WelcomeLabel2.Caption :=
    'Este assistente irá instalar o DeskLink neste computador.' + #13#10 +
    'Para continuar, clique em "Avançar".';
  WizardForm.SelectDirLabel.Caption :=
    'Utilize "Selecionar..." para escolher outro diretório ou clique em "Avançar" para prosseguir.';
  WizardForm.SelectDirBrowseLabel.Caption := '';
  WizardForm.DiskSpaceLabel.Caption := 'É necessário espaço livre suficiente em disco.';
  WizardForm.DirBrowseButton.Caption := '&Selecionar...';
  WizardForm.ReadyLabel.Caption :=
    'Revise as informações abaixo antes de iniciar a instalação. ' +
    'Clique em "Instalar" para prosseguir ou em "Voltar" para realizar alterações.';
  WizardForm.FinishedHeadingLabel.Caption := 'Instalação concluída';
  WizardForm.NextButton.Caption   := '&Avançar >';
  WizardForm.BackButton.Caption   := '< &Voltar';
  WizardForm.CancelButton.Caption := '&Cancelar';
end;

{ =========================================================================
  Eventos do wizard
  ========================================================================= }

procedure InitializeWizard;
begin
  DetectedHostDir   := '';
  DetectedServerDir := '';

  CreateRolePage;
  ApplyProfessionalUiTexts;

  { Detecta instalações anteriores (ambos podem coexistir no mesmo PC) }
  TryGetShortcutTargetDir('DeskLink Host',     DetectedHostDir);
  TryGetShortcutTargetDir('DeskLink Server', DetectedServerDir);

  { Pré-seleciona papel e diretório conforme o que foi detectado }
  if (DetectedHostDir = '') and (DetectedServerDir <> '') then
  begin
    { Somente Servidor encontrado: pré-seleciona Servidor }
    RoleHostRadio.Checked   := False;
    RoleServerRadio.Checked := True;
    WizardForm.DirEdit.Text := DetectedServerDir;
  end
  else if DetectedHostDir <> '' then
  begin
    { Host encontrado (com ou sem Servidor): pré-seleciona Host }
    RoleHostRadio.Checked   := True;
    RoleServerRadio.Checked := False;
    WizardForm.DirEdit.Text := DetectedHostDir;
  end;
  { Se nenhum foi detectado, mantém os padrões já definidos pelo wizard }
end;

procedure CurPageChanged(CurPageID: Integer);
var
  ComponentLabel: string;
  DiskLabel:      string;
begin
  ApplyProfessionalUiTexts;

  if CurPageID = RolePage.ID then
  begin
    WizardForm.PageNameLabel.Caption       := 'Tipo de instalação';
    WizardForm.PageDescriptionLabel.Caption :=
      'Selecione o papel que este computador irá desempenhar no sistema DeskLink.';
  end;

  if CurPageID = wpSelectDir then
  begin
    WizardForm.PageNameLabel.Caption        := 'Diretório de instalação';
    WizardForm.PageDescriptionLabel.Caption :=
      'Defina o diretório onde o DeskLink será instalado.';
  end;

  if CurPageID = wpReady then
  begin
    if IsServerSelected then
    begin
      ComponentLabel := '- DeskLink Server' + #13#10 + '- Dependências';
      DiskLabel      := '~300 MB';
    end
    else
    begin
      ComponentLabel := '- DeskLink Host' + #13#10 + '- Dependências';
      DiskLabel      := '~280 MB';
    end;

    WizardForm.PageNameLabel.Caption        := 'Pronto para instalação';
    WizardForm.PageDescriptionLabel.Caption :=
      'O instalador está pronto para iniciar a instalação do DeskLink neste computador.';
    WizardForm.ReadyMemo.Lines.Text :=
      'Tipo:' + #13#10 +
      IfStr(IsServerSelected, 'DeskLink Server', 'DeskLink Host') + #13#10 + #13#10 +
      'Diretório de instalação:' + #13#10 +
      WizardForm.DirEdit.Text + #13#10 + #13#10 +
      'Componentes:' + #13#10 +
      ComponentLabel + #13#10 + #13#10 +
      'Espaço em disco necessário:' + #13#10 +
      DiskLabel;
  end;

  if CurPageID = wpInstalling then
  begin
    WizardForm.PageNameLabel.Caption        := 'Instalação em andamento';
    WizardForm.PageDescriptionLabel.Caption :=
      'Aguarde enquanto o DeskLink está sendo instalado neste computador.';
  end;

  if CurPageID = wpFinished then
  begin
    WizardForm.NextButton.Caption := '&Fechar';
    WizardForm.FinishedLabel.Caption :=
      'A instalação do ' +
      IfStr(IsServerSelected, 'DeskLink Server', 'DeskLink Host') +
      ' foi concluída com sucesso.' + #13#10 +
      'Utilize o atalho criado na Área de Trabalho para iniciar o aplicativo.';
  end;
end;
