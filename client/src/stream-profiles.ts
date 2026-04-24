/** Perfis de saída de vídeo solicitados pelo controlador (IDs estáveis em inglês). */

export type StreamProfileId = "economy" | "balanced" | "high";

export const STREAM_PROFILE_IDS: StreamProfileId[] = [
  "economy",
  "balanced",
  "high",
];

/** Rótulos exibidos na UI (pt-BR). */
export const STREAM_PROFILE_SELECT_LABELS: Record<StreamProfileId, string> = {
  economy: "Economia de dados",
  balanced: "Balanceado",
  high: "Qualidade máxima",
};

export type StreamProfileEncoding = {
  maxFramerate?: number;
  maxBitrate?: number;
  scaleResolutionDownBy?: number;
};

/** Limite superior de FPS na captura do host (applyConstraints). */
export const STREAM_PROFILE_CAPTURE_FPS: Record<StreamProfileId, number> = {
  economy: 10,
  balanced: 24,
  high: 30,
};

/** Parâmetros sugeridos para RTCRtpSender.setParameters (encoding[0]). */
export const STREAM_PROFILE_ENCODING: Record<
  StreamProfileId,
  StreamProfileEncoding
> = {
  economy: {
    maxFramerate: 10,
    maxBitrate: 600_000,
    scaleResolutionDownBy: 2,
  },
  balanced: {
    maxFramerate: 24,
    maxBitrate: 2_000_000,
    scaleResolutionDownBy: 1,
  },
  high: {
    maxFramerate: 30,
    maxBitrate: 6_000_000,
    scaleResolutionDownBy: 1,
  },
};

export function parseStreamProfileId(
  raw: string,
): StreamProfileId | null {
  if (raw === "economy" || raw === "balanced" || raw === "high") return raw;
  return null;
}
