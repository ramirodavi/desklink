DeskLinkDeployWizard (Inno Setup)
---------------------------------

Objetivo
  Distribuir/atualizar o bundle desempacotado do `DeskLinkHost.exe` sem exigir admin.

Pré-requisito de build
  - Inno Setup 6 instalado ([download oficial](https://jrsoftware.org/isdl.php)) (ISCC.exe)
  - Opcional: definir ISCC_PATH se instalado em caminho customizado.

Comandos (workspace root)
  npm run build:host-bundle -w agent
  npm run prepare:wizard-payload -w agent
  npm run build:deploy-wizard -w agent

Saídas
  - payload de instalação: agent/installer/payload/
  - wizard final: agent/installer/publish/DeskLinkDeployWizard.exe
