/**
 * Rótulos e dicas de WebRTC/ICE para exibição no controlador (pt-BR).
 * Lógica pura onde possível para facilitar testes.
 */

export type IceUiSeverity = "ok" | "warn" | "err" | "neutral";

export type PathKind = "relay" | "nat" | "host" | "unknown";

export type PathInfo = {
  kind: PathKind;
  label: string;
  hint: string;
};

const PATH_LABELS: Record<PathKind, { label: string; hint: string }> = {
  relay: {
    label: "Tráfego via relay (TURN)",
    hint:
      "A conexão direta não foi possível; um servidor TURN retransmite o vídeo. Se travar, confira TURN e firewall.",
  },
  nat: {
    label: "Conexão através da internet (NAT)",
    hint: "Caminho típico pela internet com descoberta de endereço (STUN).",
  },
  host: {
    label: "Conexão direta na rede",
    hint: "Provável caminho local (LAN) ou rede com roteamento direto.",
  },
  unknown: {
    label: "em análise…",
    hint: "Aguardando estatísticas do navegador para identificar o tipo de caminho.",
  },
};

export function pathInfoFromKind(kind: PathKind): PathInfo {
  const b = PATH_LABELS[kind];
  return { kind, label: b.label, hint: b.hint };
}

/** Texto principal da pill de estado ICE (não inclui caminho de mídia). */
export function describeIceConnectionForUi(
  ice: RTCIceConnectionState,
  conn: RTCPeerConnectionState,
): { text: string; hint: string; severity: IceUiSeverity } {
  if (conn === "failed" || ice === "failed") {
    return {
      text: "ICE: falha na conexão",
      hint:
        "Verifique firewall, rede e se o servidor TURN está configurado (variáveis METERED_* ou ICE_SERVERS_JSON no servidor).",
      severity: "err",
    };
  }
  if (conn === "disconnected") {
    return {
      text: "ICE: desconectado",
      hint: "A sessão de mídia caiu. Tente reconectar ou aguarde recuperação automática.",
      severity: "warn",
    };
  }
  switch (ice) {
    case "new":
      return {
        text: "ICE: iniciando…",
        hint: "Negociação de rede começando.",
        severity: "neutral",
      };
    case "checking":
      return {
        text: "ICE: verificando conectividade…",
        hint: "Testando caminhos entre seu navegador e o host.",
        severity: "neutral",
      };
    case "connected":
    case "completed":
      return {
        text: "ICE: conectado",
        hint: "Canal de mídia estabelecido.",
        severity: "ok",
      };
    case "disconnected":
      return {
        text: "ICE: interrompido",
        hint: "Conectividade instável ou perdida momentaneamente.",
        severity: "warn",
      };
    case "closed":
      return {
        text: "ICE: encerrado",
        hint: "A sessão WebRTC foi fechada.",
        severity: "neutral",
      };
    default:
      return {
        text: `ICE: ${ice}`,
        hint: "",
        severity: "neutral",
      };
  }
}

export function describeIceGatheringForUi(
  g: RTCIceGatheringState,
): { suffix: string; hint: string } | null {
  if (g === "gathering") {
    return {
      suffix: " · procurando caminhos…",
      hint: "Coletando candidatos ICE (endereços de rede possíveis).",
    };
  }
  return null;
}

type StatDict = Record<string, unknown>;

function readStat(s: unknown, key: string): unknown {
  if (!s || typeof s !== "object") return undefined;
  return (s as StatDict)[key];
}

/**
 * Infere relay / host / nat a partir do RTCStatsReport (Chrome/Edge compatível).
 */
export function inferPathKindFromStats(report: RTCStatsReport): PathKind {
  const byId = new Map<string, StatDict>();
  report.forEach((s) => {
    byId.set(s.id, s as StatDict);
  });

  let bestPair: StatDict | null = null;
  report.forEach((s) => {
    if (s.type !== "candidate-pair") return;
    const sd = s as StatDict;
    if (String(sd.state ?? "") !== "succeeded") return;
    if (sd.nominated === true) {
      bestPair = sd;
    } else if (!bestPair) {
      bestPair = sd;
    }
  });

  if (!bestPair) {
    report.forEach((s) => {
      if (s.type !== "candidate-pair") return;
      const sd = s as StatDict;
      if (String(sd.state ?? "") === "in-progress") {
        bestPair = sd;
      }
    });
  }

  if (!bestPair) return "unknown";

  const remoteId = String(readStat(bestPair, "remoteCandidateId") ?? "");
  if (!remoteId) return "unknown";

  const remote = byId.get(remoteId);
  if (!remote) return "unknown";

  const t =
    String(
      readStat(remote, "candidateType") ??
        readStat(remote, "relayProtocol") ??
        "",
    ) || "unknown";

  if (t === "relay") return "relay";
  if (t === "host") return "host";
  if (t === "srflx" || t === "prflx") return "nat";
  return "unknown";
}
