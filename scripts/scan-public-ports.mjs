#!/usr/bin/env node
/**
 * Testa portas TCP contra um IP (ex.: seu IP público).
 *
 * Uso:
 *   node scripts/scan-public-ports.mjs
 *   node scripts/scan-public-ports.mjs 203.0.113.50
 *   node scripts/scan-public-ports.mjs --from 3000 --to 3010
 *   node scripts/scan-public-ports.mjs --full   (1-65535, demora vários minutos)
 *
 * IMPORTANTE:
 * - Testar o SEU IP a partir da SUA casa muitas vezes NÃO mostra o que chega pela internet
 *   (CGNAT, "hairpin NAT", firewall do roteador).
 * - Se o provedor usa CGNAT, port forwarding no roteador não adianta: não há IP público seu.
 * - Para saber se uma porta está aberta DE FORA, o ideal é testar de outra rede (4G, VPS, amigo).
 */

import net from "node:net";

async function getPublicIp() {
  const r = await fetch("https://api.ipify.org?format=json");
  if (!r.ok) throw new Error("api.ipify.org falhou");
  const j = await r.json();
  return j.ip;
}

function parseArgs(argv) {
  let host = null;
  let from = 3000;
  let to = 3010;
  let full = false;
  let concurrency = 80;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") from = Number(argv[++i]);
    else if (a === "--to") to = Number(argv[++i]);
    else if (a === "--full") full = true;
    else if (a === "--concurrency") concurrency = Math.min(500, Math.max(1, Number(argv[++i])));
    else if (a === "--help" || a === "-h") return { help: true };
    else if (!a.startsWith("-") && !host) host = a;
  }
  if (full) {
    from = 1;
    to = 65535;
  }
  return { host, from, to, concurrency };
}

function scanPort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host, family: 4 }, () => {
      s.destroy();
      resolve({ port, open: true });
    });
    s.on("error", () => resolve({ port, open: false }));
    s.setTimeout(timeoutMs);
    s.on("timeout", () => {
      try {
        s.destroy();
      } catch {
        /* ignore */
      }
      resolve({ port, open: false });
    });
  });
}

async function runBatch(host, ports, concurrency, timeoutMs) {
  const open = [];
  for (let i = 0; i < ports.length; i += concurrency) {
    const chunk = ports.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((p) => scanPort(host, p, timeoutMs)),
    );
    for (const r of results) {
      if (r.open) open.push(r.port);
    }
    process.stdout.write(
      `\r  Escaneadas ${Math.min(i + concurrency, ports.length)}/${ports.length}...`,
    );
  }
  process.stdout.write("\r\x1b[K");
  return open.sort((a, b) => a - b);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`
Uso: node scripts/scan-public-ports.mjs [IP] [--from N] [--to M] [--full] [--concurrency N]

Sem IP: usa seu IP público (api.ipify.org).
Padrão: portas 3000-3010 (rápido).

--full     Escaneia TCP 1-65535 (vários minutos).
--from/--to Intervalo inclusive.
`);
    process.exit(0);
  }

  const host = args.host || (await getPublicIp());
  let { from, to, concurrency } = args;

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 65535 || from > to) {
    console.error("Intervalo inválido. Use --from e --to entre 1 e 65535.");
    process.exit(1);
  }

  const total = to - from + 1;
  console.log(`Alvo: ${host} (TCP)`);
  console.log(`Portas: ${from}-${to} (${total} portas)`);
  console.log(
    `Aviso: resultado pode não bater com "o que a internet vê" se você estiver na mesma rede do IP.\n`,
  );

  const ports = [];
  for (let p = from; p <= to; p++) ports.push(p);

  const t0 = Date.now();
  const openPorts = await runBatch(host, ports, concurrency, 350);
  const ms = Date.now() - t0;

  console.log(`Tempo: ${(ms / 1000).toFixed(1)}s\n`);
  if (openPorts.length === 0) {
    console.log(
      "Nenhuma porta respondeu com TCP aceito neste teste (da máquina onde o script rodou).",
    );
    console.log(
      "Isso NÃO prova que seu provedor bloqueia tudo: muitas portas ficam 'fechadas' se não há serviço ouvindo.",
    );
  } else {
    console.log("Portas com conexão TCP estabelecida (podem ser serviços locais, roteador, etc.):");
    console.log(openPorts.join(", "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
