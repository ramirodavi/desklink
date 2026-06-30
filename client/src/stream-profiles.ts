/** Perfis de saída de vídeo solicitados pelo controlador (IDs estáveis em inglês). */

export type StreamProfileId = "economy" | "balanced" | "high";

export function parseStreamProfileId(
  raw: string,
): StreamProfileId | null {
  if (raw === "economy" || raw === "balanced" || raw === "high") return raw;
  return null;
}
