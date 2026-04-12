/**
 * Resolução de servidores ICE: lista estática (env), Metered (API), ou STUN padrão.
 */

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const DEFAULT_STUN: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

let meteredCache: { servers: IceServerConfig[]; expires: number } | null = null;

const METERED_CACHE_MS = 5 * 60 * 1000;

/**
 * Busca credenciais TURN na API Metered (rotativas).
 * @see https://www.metered.ca/tools/openrelay/
 */
export async function fetchMeteredIceServers(): Promise<IceServerConfig[] | null> {
  const domain = process.env.METERED_DOMAIN?.trim();
  const apiKey = process.env.METERED_API_KEY?.trim();
  if (!domain || !apiKey) return null;

  if (meteredCache && Date.now() < meteredCache.expires) {
    return meteredCache.servers;
  }

  const url = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Metered TURN: HTTP ${res.status} ${res.statusText}`);
  }

  const data: unknown = await res.json();
  let servers: IceServerConfig[] | undefined;

  if (Array.isArray(data)) {
    servers = data as IceServerConfig[];
  } else if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const inner = o.iceServers ?? o.ice_servers;
    if (Array.isArray(inner)) servers = inner as IceServerConfig[];
  }

  if (!servers?.length) {
    throw new Error("Metered TURN: resposta sem iceServers");
  }

  meteredCache = {
    servers,
    expires: Date.now() + METERED_CACHE_MS,
  };
  return servers;
}

function parseIceServersJson(raw: string): IceServerConfig[] | null {
  try {
    const parsed = JSON.parse(raw) as IceServerConfig[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Ordem: `ICE_SERVERS_JSON` (sobrescreve tudo) → Metered (`METERED_DOMAIN` + `METERED_API_KEY`) → STUN Google.
 */
export async function resolveIceServers(): Promise<IceServerConfig[]> {
  const raw = process.env.ICE_SERVERS_JSON;
  if (raw) {
    const parsed = parseIceServersJson(raw);
    if (parsed) return parsed;
  }

  const metered = await fetchMeteredIceServers();
  if (metered?.length) return metered;

  return DEFAULT_STUN;
}
