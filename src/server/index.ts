import http from "node:http";
import { WebSocketServer } from "ws";
import { getDbBackend, pingDb } from "../db/index.js";
import { env, getAdminIds } from "../env.js";
import { createApp } from "./app.js";
import { isAdmin } from "./auth.js";
import {
  getBotState,
  pauseBot,
  resumeBot,
  setBroadcast,
  stopBot,
} from "./bot-runner.js";
import {
  getVacVerifyState,
  setBroadcast as setVacBroadcast,
  startVacVerifyScheduler,
  stopVacVerify,
} from "./vac-verify.js";
import { consumeToken } from "./ws-tokens.js";

const PORT = env.PORT;

async function start() {
  try {
    await pingDb();
    console.log(`DB: ${getDbBackend()} — OK (${env.SQLITE_PATH})`);
  } catch (e) {
    console.error("DB connection failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const app = createApp(PORT);
  const httpServer = http.createServer(app);

  const adminClients = new Set<import("ws").WebSocket>();
  const broadcastAdmin = () => {
    const payload = JSON.stringify({
      bot: getBotState(),
      vacVerify: getVacVerifyState(),
    });
    for (const ws of adminClients) {
      if (ws.readyState === 1) ws.send(payload);
    }
  };
  setBroadcast(broadcastAdmin);
  setVacBroadcast(broadcastAdmin);

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    if (url.pathname !== "/admin/ws") {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token");
    const steamId = token ? consumeToken(token) : null;
    if (!steamId || !isAdmin(steamId)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
  wss.on("connection", (ws) => {
    adminClients.add(ws);
    ws.send(
      JSON.stringify({ bot: getBotState(), vacVerify: getVacVerifyState() }),
    );
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { cmd?: string };
        if (msg.cmd === "pause") pauseBot();
        else if (msg.cmd === "resume") resumeBot();
        else if (msg.cmd === "stop") stopBot();
        else if (msg.cmd === "vacVerifyStop") stopVacVerify();
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => adminClients.delete(ws));
  });

  httpServer.listen(PORT, () => {
    console.log(`API: http://localhost:${PORT}`);
    if (getAdminIds().size) {
      console.log(`Admin auth routes on :${PORT}`);
    }
    void startVacVerifyScheduler();
  });
}

start();
