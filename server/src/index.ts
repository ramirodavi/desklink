import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { resolveIceServers, type IceServerConfig } from "./ice-servers.js";

export type { IceServerConfig };

export interface ServerStartOptions {
  /** Porta TCP. Padrão: env PORT ou 3000. */
  port?: number;
  /** Caminho para client/dist servido como estático. */
  clientDistPath?: string;
  /** Caminho para o ícone de marca servido em /api/brand-icon. */
  brandIconPath?: string;
  /** Chamado quando o servidor começa a escutar na porta. */
  onReady?: (port: number) => void;
}

export async function startServer(opts?: ServerStartOptions): Promise<void> {
  // __dirname é resolvido via import.meta.url apenas em modo standalone (sem opts),
  // evitando que fileURLToPath seja chamado com undefined em bundles CJS (esbuild).
  const getServerDir = (): string =>
    path.dirname(fileURLToPath(import.meta.url));

  // Carregar .env somente em modo standalone (sem opts externos)
  if (!opts) {
    dotenv.config({ path: path.join(getServerDir(), "..", ".env") });
  }

  const PORT = opts?.port ?? (Number(process.env.PORT) || 3000);
  const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "*";
  const CONTROLLER_GRACE_MS = 45_000;
  const HOST_GRACE_MS = 45_000;

  const clientDist =
    opts?.clientDistPath ?? path.resolve(getServerDir(), "../../client/dist");
  const brandIconPath =
    opts?.brandIconPath ??
    path.resolve(getServerDir(), "../../agent/build/icon.png");

  const app = express();
  app.use(cors({ origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN }));
  app.use(express.static(clientDist));

  app.get("/api/brand-icon", (_req, res) => {
    res.sendFile(brandIconPath, (err) => {
      if (err) {
        res.status(404).end();
      }
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  /** ICE servers — STUN/TURN: env estático, Metered (API), ou STUN padrão */
  app.get("/api/ice-servers", async (_req, res) => {
    try {
      const servers = await resolveIceServers();
      res.json(servers);
    } catch (e) {
      console.error("[api/ice-servers]", e);
      res.status(500).json({
        error: "Falha ao obter servidores ICE",
        detail: String(e),
      });
    }
  });

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: CLIENT_ORIGIN === "*" ? "*" : CLIENT_ORIGIN,
      methods: ["GET", "POST"],
    },
  });

  type Role = "host" | "controller";

  interface RoomPeer {
    socketId: string;
    role: Role;
  }

  interface RoomState {
    sessionId: string;
    host?: RoomPeer;
    controller?: RoomPeer;
    hostWebRtcReady?: boolean;
    controllerWebRtcReady?: boolean;
    /** Host já clicou em "Iniciar compartilhamento" (webrtc-host-ready). */
    hostSharingStarted?: boolean;
    sessionEpoch: number;
    controllerGraceTimer?: ReturnType<typeof setTimeout>;
    controllerGracePending?: boolean;
    hostGraceTimer?: ReturnType<typeof setTimeout>;
    hostGracePending?: boolean;
  }

  const rooms = new Map<string, RoomState>();

  function roomKey(sessionId: string) {
    return `session:${sessionId}`;
  }

  function getOrCreateRoom(sessionId: string): RoomState {
    let r = rooms.get(sessionId);
    if (!r) {
      r = { sessionId, sessionEpoch: 0 };
      rooms.set(sessionId, r);
    }
    return r;
  }

  function clearControllerGrace(state: RoomState) {
    if (state.controllerGraceTimer) {
      clearTimeout(state.controllerGraceTimer);
      state.controllerGraceTimer = undefined;
    }
    state.controllerGracePending = false;
  }

  function emitControllerPeerLeft(sessionId: string) {
    io.to(roomKey(sessionId)).emit("peer-left", { role: "controller" });
  }

  function clearHostGrace(state: RoomState) {
    if (state.hostGraceTimer) {
      clearTimeout(state.hostGraceTimer);
      state.hostGraceTimer = undefined;
    }
    state.hostGracePending = false;
  }

  function emitHostPeerLeft(sessionId: string) {
    io.to(roomKey(sessionId)).emit("peer-left", { role: "host" });
  }

  function scheduleHostGraceLeave(sessionId: string, state: RoomState) {
    clearHostGrace(state);
    state.host = undefined;
    state.hostWebRtcReady = false;

    if (!state.hostSharingStarted) {
      emitHostPeerLeft(sessionId);
      return;
    }

    state.hostGracePending = true;
    state.hostGraceTimer = setTimeout(() => {
      state.hostGraceTimer = undefined;
      state.hostGracePending = false;
      const current = rooms.get(sessionId);
      if (!current) return;
      current.hostSharingStarted = false;
      emitHostPeerLeft(sessionId);
    }, HOST_GRACE_MS);
  }

  function roomIsEmpty(state: RoomState): boolean {
    return (
      !state.host &&
      !state.controller &&
      !state.controllerGracePending &&
      !state.hostGracePending
    );
  }

  function isSocketConnected(socketId: string): boolean {
    const s = io.sockets.sockets.get(socketId);
    return Boolean(s?.connected);
  }

  function scheduleControllerGraceLeave(sessionId: string, state: RoomState) {
    clearControllerGrace(state);
    state.controller = undefined;
    state.controllerWebRtcReady = false;

    if (!state.hostSharingStarted || !state.host) {
      emitControllerPeerLeft(sessionId);
      return;
    }

    state.controllerGracePending = true;
    state.controllerGraceTimer = setTimeout(() => {
      state.controllerGraceTimer = undefined;
      state.controllerGracePending = false;
      const current = rooms.get(sessionId);
      if (!current) return;
      emitControllerPeerLeft(sessionId);
    }, CONTROLLER_GRACE_MS);
  }

  function leaveRoom(socketId: string) {
    for (const [sid, state] of rooms) {
      if (state.host?.socketId === socketId) {
        clearControllerGrace(state);
        scheduleHostGraceLeave(sid, state);
      }
      if (state.controller?.socketId === socketId) {
        scheduleControllerGraceLeave(sid, state);
      }
      if (roomIsEmpty(state)) {
        rooms.delete(sid);
      }
    }
  }

  function bumpSessionEpoch(sessionId: string): number {
    const state = rooms.get(sessionId);
    if (!state) return 0;
    state.sessionEpoch += 1;
    return state.sessionEpoch;
  }

  function tryEmitBothReady(sessionId: string) {
    const state = rooms.get(sessionId);
    if (!state?.host || !state.controller) return;
    if (state.hostWebRtcReady && state.controllerWebRtcReady) {
      io.to(state.host.socketId).emit("webrtc-both-ready", { sessionId });
    }
  }

  io.on("connection", (socket) => {
    socket.on(
      "join",
      (
        payload: {
          sessionId: string;
          role: Role;
          wasSharing?: boolean;
        },
        ack?: (err: string | null) => void,
      ) => {
        const { sessionId, role, wasSharing } = payload;
        if (!sessionId || !role) {
          ack?.("sessionId e role são obrigatórios");
          return;
        }
        const state = getOrCreateRoom(sessionId);
        if (role === "host") {
          if (state.host && state.host.socketId !== socket.id) {
            if (isSocketConnected(state.host.socketId)) {
              ack?.("Já existe um host nesta sessão");
              return;
            }
          }
          const hadHostGrace = Boolean(
            state.hostGracePending || state.hostGraceTimer,
          );
          clearHostGrace(state);
          state.host = { socketId: socket.id, role: "host" };
          state.hostWebRtcReady = false;
          if (wasSharing) {
            state.hostSharingStarted = true;
          } else if (!state.hostSharingStarted) {
            state.hostSharingStarted = false;
          }
          if (hadHostGrace && state.controller) {
            io.to(state.controller.socketId).emit("host-rejoined", {
              sessionId,
              sessionEpoch: state.sessionEpoch,
            });
          }
        } else {
          if (!state.host) {
            if (state.hostGracePending && state.hostSharingStarted) {
              if (state.controller && state.controller.socketId !== socket.id) {
                if (isSocketConnected(state.controller.socketId)) {
                  ack?.("Já existe um controlador nesta sessão");
                  return;
                }
              }
              state.controller = { socketId: socket.id, role: "controller" };
              state.controllerWebRtcReady = false;
              void socket.join(roomKey(sessionId));
              ack?.(null);
              return;
            }
            ack?.(
              "Nenhum host nesta sessão com este código. Confira o UUID ou aguarde o DeskLink no PC remoto.",
            );
            return;
          }
          if (!state.hostSharingStarted) {
            ack?.(
              "O host ainda não iniciou o compartilhamento. Peça para abrir o DeskLink, colar o servidor e clicar em \u201cIniciar compartilhamento\u201d, depois tente de novo.",
            );
            return;
          }
          const hadGrace = Boolean(
            state.controllerGracePending || state.controllerGraceTimer,
          );
          clearControllerGrace(state);
          if (state.controller && state.controller.socketId !== socket.id) {
            if (isSocketConnected(state.controller.socketId)) {
              ack?.("Já existe um controlador nesta sessão");
              return;
            }
          }
          state.controller = { socketId: socket.id, role: "controller" };
          state.controllerWebRtcReady = false;
          if (hadGrace && state.host) {
            io.to(state.host.socketId).emit("controller-rejoined", {
              sessionId,
              sessionEpoch: state.sessionEpoch,
            });
          }
        }
        void socket.join(roomKey(sessionId));
        ack?.(null);
      },
    );

    socket.on("webrtc-host-ready", (payload: { sessionId: string }) => {
      const { sessionId } = payload;
      const state = rooms.get(sessionId);
      if (!state?.host || state.host.socketId !== socket.id) return;
      bumpSessionEpoch(sessionId);
      state.hostWebRtcReady = true;
      state.hostSharingStarted = true;
      tryEmitBothReady(sessionId);
    });

    socket.on("webrtc-controller-ready", (payload: { sessionId: string }) => {
      const { sessionId } = payload;
      const state = rooms.get(sessionId);
      if (!state?.controller || state.controller.socketId !== socket.id) return;
      state.controllerWebRtcReady = true;
      tryEmitBothReady(sessionId);
    });

    socket.on("webrtc-host-reset", (payload: { sessionId: string }) => {
      const { sessionId } = payload;
      const state = rooms.get(sessionId);
      if (!state?.host || state.host.socketId !== socket.id) return;
      clearControllerGrace(state);
      clearHostGrace(state);
      state.hostWebRtcReady = false;
      state.hostSharingStarted = false;
    });

    socket.on("controller-video-ready", (payload: { sessionId: string }) => {
      const { sessionId } = payload;
      const state = rooms.get(sessionId);
      if (!state?.controller || state.controller.socketId !== socket.id) return;
      if (!state.host) return;
      io.to(state.host.socketId).emit("controller-video-ready", { sessionId });
    });

    socket.on(
      "signal",
      (payload: { sessionId: string; type: string; sdp?: string }) => {
        const { sessionId, type, sdp } = payload;
        const state = rooms.get(sessionId);
        if (!state) return;
        const other =
          state.host?.socketId === socket.id
            ? state.controller?.socketId
            : state.host?.socketId;
        if (!other) return;
        io.to(other).emit("signal", { type, sdp, from: socket.id });
      },
    );

    socket.on(
      "ice-candidate",
      (payload: {
        sessionId: string;
        candidate: {
          candidate?: string;
          sdpMLineIndex?: number | null;
          sdpMid?: string | null;
        } | null;
      }) => {
        const { sessionId, candidate } = payload;
        const state = rooms.get(sessionId);
        if (!state) return;
        const other =
          state.host?.socketId === socket.id
            ? state.controller?.socketId
            : state.host?.socketId;
        if (!other) return;
        io.to(other).emit("ice-candidate", { candidate, from: socket.id });
      },
    );

    socket.on("disconnect", () => {
      leaveRoom(socket.id);
    });
  });

  return new Promise<void>((resolve) => {
    httpServer.listen(PORT, () => {
      console.log(`DeskLink server em http://localhost:${PORT}`);
      console.log(
        "ICE: ICE_SERVERS_JSON (opcional) ou METERED_DOMAIN + METERED_API_KEY (Metered).",
      );
      opts?.onReady?.(PORT);
      resolve();
    });
  });
}
