/**
 * Mantido alinhado a client/src/stream-profiles.ts (mesmos valores numéricos).
 */
export type StreamProfileId = "economy" | "balanced" | "high";

export type StreamProfileEncoding = {
  maxFramerate?: number;
  maxBitrate?: number;
  scaleResolutionDownBy?: number;
};

export const STREAM_PROFILE_CAPTURE_FPS: Record<StreamProfileId, number> = {
  economy: 10,
  balanced: 24,
  high: 30,
};

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
