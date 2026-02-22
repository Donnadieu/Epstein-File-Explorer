import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./index";

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = req.url?.split("?")[0];
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
    // Other paths (e.g. /vite-hmr) are left for Vite's handler
  });
  let activeConnections = 0;

  function broadcast() {
    const message = JSON.stringify({ type: "active-users", count: activeConnections });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  wss.on("connection", (ws) => {
    activeConnections++;
    broadcast();

    const alive = { current: true };

    ws.on("pong", () => {
      alive.current = true;
    });

    ws.on("close", () => {
      activeConnections--;
      broadcast();
    });

    const heartbeat = setInterval(() => {
      if (!alive.current) {
        ws.terminate();
        return;
      }
      alive.current = false;
      ws.ping();
    }, 30_000);

    ws.on("close", () => clearInterval(heartbeat));
  });

  log("WebSocket server ready on /ws", "ws");
}
