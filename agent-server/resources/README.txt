Coloque aqui o arquivo cloudflared.exe antes de executar o build.

Baixe em: https://github.com/cloudflare/cloudflared/releases
Arquivo:  cloudflared-windows-amd64.exe
Renomeie para: cloudflared.exe

Se o arquivo não estiver presente, o DeskLink Server tentará encontrar
cloudflared.exe no PATH do sistema ou na raiz do repositório.

---

Ícone do Servidor (build/icon.png):
  Arte-fonte versionada no repositório, no mesmo padrão do Host (agent/build/icon.png).
  Edite build/icon.png manualmente e execute `npm run build-icon -w agent-server` para
  regenerar build/icon.ico.

  Para recriar a partir do Host (apenas na primeira vez ou reset):
  `npm run generate-icon-source -w agent-server`
