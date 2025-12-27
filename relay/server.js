const fs = require("fs");
const path = require("path");
const https = require("https");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const PORT = Number(process.env.RELAY_PORT || 4433);
const CERT_PATH =
  process.env.RELAY_CERT_PATH ||
  path.join(__dirname, "cert", "cert.pem");
const KEY_PATH =
  process.env.RELAY_KEY_PATH ||
  path.join(__dirname, "cert", "key.pem");

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function randomId(prefix = "") {
  return `${prefix}${crypto.randomBytes(8).toString("hex")}`;
}

function requireFile(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(
      `${label} introuvable: ${p}\n` +
        `Générez des certs via: npm run relay:cert`
    );
  }
  return fs.readFileSync(p);
}

const tlsOptions = {
  cert: requireFile(CERT_PATH, "Certificat TLS"),
  key: requireFile(KEY_PATH, "Clé TLS"),
};

const server = https.createServer(tlsOptions, (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify(
      {
        ok: true,
        service: "remote-browser-relay",
        time: nowIso(),
        endpoints: ["/agent (wss)", "/cli (wss)"],
      },
      null,
      2
    )
  );
});

/**
 * agentId -> { ws, connectedAt, meta }
 */
const agents = new Map();

/**
 * cliWs -> { cliId, connectedAt, attachedAgentId|null }
 */
const clis = new Map();

function listAgents() {
  return Array.from(agents.entries()).map(([agentId, info]) => ({
    agentId,
    connectedAt: info.connectedAt,
    meta: info.meta || {},
  }));
}

function broadcastToClis(msgObj) {
  const data = JSON.stringify(msgObj);
  for (const [ws] of clis) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const pathname = url.pathname;
  if (pathname !== "/agent" && pathname !== "/cli") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.__pathname = pathname;
    ws.__remote = req.socket.remoteAddress;
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  const pathname = ws.__pathname;
  const remote = ws.__remote;

  if (pathname === "/agent") {
    const agentId = randomId("ag_");
    const agentInfo = {
      ws,
      connectedAt: nowIso(),
      meta: {},
    };
    agents.set(agentId, agentInfo);

    console.log(`[${nowIso()}] agent connected ${agentId} from ${remote}`);

    // Informer l'agent de son id
    ws.send(JSON.stringify({ type: "hello", agentId }));
    broadcastToClis({ type: "agents", agents: listAgents() });

    ws.on("message", (buf) => {
      const str = buf.toString();
      const msg = safeJsonParse(str);
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "meta" && msg.meta && typeof msg.meta === "object") {
        agentInfo.meta = msg.meta;
        broadcastToClis({ type: "agents", agents: listAgents() });
        return;
      }

      // Bridge CDP: agent -> cli(s) attachés
      if (msg.type === "cdp" && typeof msg.message === "string") {
        for (const [cliWs, cliState] of clis) {
          if (cliState.attachedAgentId === agentId && cliWs.readyState === cliWs.OPEN) {
            cliWs.send(
              JSON.stringify({
                type: "cdp",
                agentId,
                message: msg.message,
              })
            );
          }
        }
      }
    });

    ws.on("close", () => {
      agents.delete(agentId);
      console.log(`[${nowIso()}] agent disconnected ${agentId}`);
      // Détacher les CLIs qui étaient attachés
      for (const [, cliState] of clis) {
        if (cliState.attachedAgentId === agentId) cliState.attachedAgentId = null;
      }
      broadcastToClis({ type: "agents", agents: listAgents() });
    });

    ws.on("error", (err) => {
      console.log(`[${nowIso()}] agent error ${agentId}: ${err.message}`);
    });

    return;
  }

  if (pathname === "/cli") {
    const cliId = randomId("cli_");
    const cliState = {
      cliId,
      connectedAt: nowIso(),
      attachedAgentId: null,
    };
    clis.set(ws, cliState);
    console.log(`[${nowIso()}] cli connected ${cliId} from ${remote}`);

    // welcome + état initial
    ws.send(JSON.stringify({ type: "hello", cliId, agents: listAgents() }));

    ws.on("message", (buf) => {
      const str = buf.toString();
      const msg = safeJsonParse(str);
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "list") {
        ws.send(JSON.stringify({ type: "agents", agents: listAgents() }));
        return;
      }

      if (msg.type === "attach") {
        const agentId = msg.agentId;
        if (!agentId || typeof agentId !== "string") {
          ws.send(JSON.stringify({ type: "error", message: "agentId manquant" }));
          return;
        }
        if (!agents.has(agentId)) {
          ws.send(JSON.stringify({ type: "error", message: `agentId inconnu: ${agentId}` }));
          return;
        }
        cliState.attachedAgentId = agentId;
        ws.send(JSON.stringify({ type: "attached", agentId }));
        return;
      }

      if (msg.type === "detach") {
        cliState.attachedAgentId = null;
        ws.send(JSON.stringify({ type: "detached" }));
        return;
      }

      // Bridge CDP: cli -> agent attaché
      if (msg.type === "cdp" && typeof msg.message === "string") {
        const agentId = msg.agentId || cliState.attachedAgentId;
        if (!agentId) {
          ws.send(JSON.stringify({ type: "error", message: "Non attaché à un agent (utilisez attach)" }));
          return;
        }
        const agent = agents.get(agentId);
        if (!agent) {
          ws.send(JSON.stringify({ type: "error", message: `agent hors ligne: ${agentId}` }));
          return;
        }
        if (agent.ws.readyState !== agent.ws.OPEN) {
          ws.send(JSON.stringify({ type: "error", message: `socket agent non prêt: ${agentId}` }));
          return;
        }
        agent.ws.send(JSON.stringify({ type: "cdp", message: msg.message }));
      }
    });

    ws.on("close", () => {
      clis.delete(ws);
      console.log(`[${nowIso()}] cli disconnected ${cliId}`);
    });

    ws.on("error", (err) => {
      console.log(`[${nowIso()}] cli error ${cliId}: ${err.message}`);
    });

    return;
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[${nowIso()}] relay listening on https://0.0.0.0:${PORT}`);
  console.log(`- WSS agent: wss://<ip>:${PORT}/agent`);
  console.log(`- WSS cli  : wss://<ip>:${PORT}/cli`);
  console.log(`- health   : https://<ip>:${PORT}/healthz`);
});

