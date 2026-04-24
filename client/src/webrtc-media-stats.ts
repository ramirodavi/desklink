/**
 * Extração de métricas de getStats e heurística de qualidade (pt-BR).
 */

import { pathInfoFromKind, inferPathKindFromStats } from "./webrtc-connection-info.js";

export type MediaStatsSnapshot = {
  rttMs: number | null;
  fps: number | null;
  lossPct: number | null;
};

export type QualityTier = "good" | "fair" | "poor";

export type QualityResult = {
  tier: QualityTier;
  label: string;
  reasons: string[];
};

const TIER_LABELS: Record<QualityTier, string> = {
  good: "Boa",
  fair: "Instável",
  poor: "Ruim",
};

function fmtPctPt(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(n);
}

function fmtMs(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

/** Extrai RTT (ms) do par de candidatos selecionado, se disponível. */
export function extractRoundTripTimeMs(report: RTCStatsReport): number | null {
  let rtt: number | null = null;
  report.forEach((s) => {
    if (s.type !== "candidate-pair") return;
    const sd = s as Record<string, unknown>;
    const sec = sd.currentRoundTripTime;
    if (typeof sec === "number" && Number.isFinite(sec) && sec > 0) {
      const ms = sec * 1000;
      if (rtt === null || ms < rtt) rtt = ms;
    }
  });
  return rtt;
}

/** inbound-rtp vídeo: fps, perda aproximada. */
export function extractInboundVideoStats(
  report: RTCStatsReport,
): MediaStatsSnapshot {
  let fps: number | null = null;
  let lossPct: number | null = null;
  let rttMs: number | null = extractRoundTripTimeMs(report);

  report.forEach((s) => {
    if (s.type !== "inbound-rtp") return;
    const sd = s as Record<string, unknown>;
    const kind = sd.kind ?? sd.mediaType;
    if (kind !== "video") return;

    const fr = sd.framesPerSecond;
    if (typeof fr === "number" && Number.isFinite(fr)) {
      fps = fr;
    }

    const lost = sd.packetsLost;
    const recv = sd.packetsReceived;
    if (
      typeof lost === "number" &&
      typeof recv === "number" &&
      lost + recv > 0
    ) {
      lossPct = (100 * lost) / (lost + recv);
    }
  });

  return { rttMs, fps, lossPct };
}

/**
 * Regras conservadoras; `reasons` em pt-BR para tooltip.
 */
export function deriveQuality(snapshot: MediaStatsSnapshot): QualityResult {
  const { rttMs, fps, lossPct } = snapshot;
  const reasons: string[] = [];

  let score = 0;

  if (rttMs != null) {
    if (rttMs > 200) {
      score += 2;
      reasons.push(`Latência alta (${fmtMs(rttMs)} ms).`);
    } else if (rttMs > 120) {
      score += 1;
      reasons.push(`Latência moderada (${fmtMs(rttMs)} ms).`);
    }
  } else {
    reasons.push("Latência (RTT) indisponível neste navegador.");
  }

  if (lossPct != null) {
    if (lossPct > 2) {
      score += 2;
      reasons.push(`Perda de pacotes elevada (${fmtPctPt(lossPct)}%).`);
    } else if (lossPct > 0.5) {
      score += 1;
      reasons.push(`Alguma perda de pacotes (${fmtPctPt(lossPct)}%).`);
    }
  }

  if (fps != null) {
    const fpsInt = new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 0,
    }).format(Math.round(fps));
    if (fps < 8) {
      score += 2;
      reasons.push(`Taxa de quadros baixa (${fpsInt} fps).`);
    } else if (fps < 15) {
      score += 1;
      reasons.push(`Taxa de quadros moderada (${fpsInt} fps).`);
    }
  }

  let tier: QualityTier;
  if (score >= 3) tier = "poor";
  else if (score >= 1) tier = "fair";
  else tier = "good";

  if (reasons.length === 0) {
    reasons.push("Parâmetros dentro do esperado para uso confortável.");
  }

  return {
    tier,
    label: TIER_LABELS[tier],
    reasons,
  };
}

export function formatMetricsLine(
  snap: MediaStatsSnapshot,
  quality: QualityResult,
): string {
  const rtt =
    snap.rttMs != null ? `RTT ${fmtMs(snap.rttMs)} ms` : "RTT —";
  const fps =
    snap.fps != null ? `${fmtPctPt(snap.fps)} fps` : "fps —";
  const loss =
    snap.lossPct != null
      ? `perda ${fmtPctPt(snap.lossPct)}%`
      : "perda —";
  return `${rtt} · ${fps} · ${loss} · Qualidade: ${quality.label}`;
}

export function buildPathPillFromReport(report: RTCStatsReport): {
  label: string;
  hint: string;
} {
  const kind = inferPathKindFromStats(report);
  const info = pathInfoFromKind(kind);
  return { label: `Caminho: ${info.label}`, hint: info.hint };
}

export type { PathKind } from "./webrtc-connection-info.js";
