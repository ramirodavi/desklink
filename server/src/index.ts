import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { resolveIceServers, type IceServerConfig } from "./ice-servers.js";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "*";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN }));
app.use(express.json());

const clientDist = path.resolve(__dirname, "../../client/dist");
const brandIconPath = path.resolve(__dirname, "../../agent/build/icon.png");
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

export type { IceServerConfig };

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
  /** Host já clicou em “Iniciar compartilhamento” (webrtc-host-ready). */
  hostSharingStarted?: boolean;
}

const rooms = new Map<string, RoomState>();

function roomKey(sessionId: string) {
  return `session:${sessionId}`;
}

function getOrCreateRoom(sessionId: string): RoomState {
  let r = rooms.get(sessionId);
  if (!r) {
    r = { sessionId };
    rooms.set(sessionId, r);
  }
  return r;
}

function leaveRoom(socketId: string) {
  for (const [sid, state] of rooms) {
    if (state.host?.socketId === socketId) {
      state.host = undefined;
      state.hostWebRtcReady = false;
      state.hostSharingStarted = false;
      io.to(roomKey(sid)).emit("peer-left", { role: "host" });
    }
    if (state.controller?.socketId === socketId) {
      state.controller = undefined;
      state.controllerWebRtcReady = false;
      io.to(roomKey(sid)).emit("peer-left", { role: "controller" });
    }
    if (!state.host && !state.controller) rooms.delete(sid);
  }
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
      payload: { sessionId: string; role: Role },
      ack?: (err: string | null) => void,
    ) => {
      const { sessionId, role } = payload;
      if (!sessionId || !role) {
        ack?.("sessionId e role são obrigatórios");
        return;
      }
      const state = getOrCreateRoom(sessionId);
      if (role === "host") {
        if (state.host && state.host.socketId !== socket.id) {
          ack?.("Já existe um host nesta sessão");
          return;
        }
        state.host = { socketId: socket.id, role: "host" };
        state.hostWebRtcReady = false;
        state.hostSharingStarted = false;
      } else {
        if (!state.host) {
          ack?.(
            "Nenhum host nesta sessão com este código. Confira o UUID ou aguarde o DeskLink no PC remoto.",
          );
          return;
        }
        if (!state.hostSharingStarted) {
          ack?.(
            "O host ainda não iniciou o compartilhamento. Peça para abrir o DeskLink, colar o servidor e clicar em “Iniciar compartilhamento”, depois tente de novo.",
          );
          return;
        }
        if (state.controller && state.controller.socketId !== socket.id) {
          ack?.("Já existe um controlador nesta sessão");
          return;
        }
        state.controller = { socketId: socket.id, role: "controller" };
        state.controllerWebRtcReady = false;
      }
      void socket.join(roomKey(sessionId));
      ack?.(null);
    },
  );

  socket.on("webrtc-host-ready", (payload: { sessionId: string }) => {
    const { sessionId } = payload;
    const state = rooms.get(sessionId);
    if (!state?.host || state.host.socketId !== socket.id) return;
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
      candidate: { candidate?: string; sdpMLineIndex?: number | null; sdpMid?: string | null } | null;
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

httpServer.listen(PORT, () => {
  console.log(`DeskLink server em http://localhost:${PORT}`);
  console.log(
    `ICE: ICE_SERVERS_JSON (opcional) ou METERED_DOMAIN + METERED_API_KEY (Metered).`,
  );
});
