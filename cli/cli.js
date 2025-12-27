#!/usr/bin/env node

const WebSocket = require("ws");
const { assertPinnedFingerprint } = require("../shared/tls-pinning");

const RELAY_IP = process.env.RELAY_IP || "109.176.198.25";
const RELAY_PORT = Number(process.env.RELAY_PORT || 4433);
const RELAY_BASE_URL =
  process.env.RELAY_URL || `wss://${RELAY_IP}:${RELAY_PORT}`;
const RELAY_CLI_URL = `${RELAY_BASE_URL.replace(/\/$/, "")}/cli`;

const RELAY_CERT_FINGERPRINT256 = process.env.RELAY_CERT_FINGERPRINT256 || "";
const RELAY_INSECURE_SKIP_PINNING = process.env.RELAY_INSECURE_SKIP_PINNING === "1";

function usage() {
  console.log(`Usage:
  node cli/cli.js list
  node cli/cli.js attach <agentId>
  node cli/cli.js navigate <agentId> <url>
  node cli/cli.js eval <agentId> <jsExpression>

Env:
  RELAY_URL='wss://109.176.198.25:4433'
  RELAY_CERT_FINGERPRINT256='AA:BB:...'
  RELAY_INSECURE_SKIP_PINNING=1   (dev uniquement)
`);
}

function connectRelayCli() {
  const ws = new WebSocket(RELAY_CLI_URL, { rejectUnauthorized: false });

  ws.on("open", () => {
    try {
      if (!RELAY_INSECURE_SKIP_PINNING) {
        assertPinnedFingerprint(ws, RELAY_CERT_FINGERPRINT256);
      } else {
        console.log("⚠️  RELAY_INSECURE_SKIP_PINNING=1 (pinning désactivé)");
      }
    } catch (e) {
      console.error("❌ TLS pinning a échoué:", e.message);
      ws.terminate();
    }
  });

  return ws;
}

async function waitHello(ws) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout hello")), 5000);
    ws.on("message", function onMsg(buf) {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (msg.type === "hello") {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(msg);
      }
    });
  });
}

async function requestAgents(ws) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout agents")), 5000);
    const onMsg = (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (msg.type === "agents") {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(msg.agents || []);
      }
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ type: "list" }));
  });
}

async function attach(ws, agentId) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout attach")), 5000);
    const onMsg = (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (msg.type === "attached" && msg.agentId === agentId) {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve();
      }
      if (msg.type === "error") {
        clearTimeout(t);
        ws.off("message", onMsg);
        reject(new Error(msg.message || "error"));
      }
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ type: "attach", agentId }));
  });
}

function createCdpClient(ws, agentId) {
  let id = 1;
  const pending = new Map();

  ws.on("message", (buf) => {
    let env;
    try {
      env = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (env.type !== "cdp" || env.agentId !== agentId || typeof env.message !== "string") {
      return;
    }
    let msg;
    try {
      msg = JSON.parse(env.message);
    } catch {
      return;
    }
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || "CDP error"));
      else resolve(msg.result);
    }
  });

  function send(method, params = {}) {
    const myId = id++;
    const payload = JSON.stringify({ id: myId, method, params });
    ws.send(JSON.stringify({ type: "cdp", agentId, message: payload }));
    return new Promise((resolve, reject) => {
      pending.set(myId, { resolve, reject });
      setTimeout(() => {
        if (pending.has(myId)) {
          pending.delete(myId);
          reject(new Error(`timeout CDP (${method})`));
        }
      }, 10000);
    });
  }

  return { send };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    usage();
    process.exit(1);
  }

  if (!RELAY_INSECURE_SKIP_PINNING && !RELAY_CERT_FINGERPRINT256) {
    console.error("❌ RELAY_CERT_FINGERPRINT256 requis (ou RELAY_INSECURE_SKIP_PINNING=1 pour dev)");
    process.exit(1);
  }

  const ws = connectRelayCli();
  ws.on("error", (e) => console.error("WS error:", e.message));

  await new Promise((r) => ws.once("open", r));
  await waitHello(ws);

  if (cmd === "list") {
    const agents = await requestAgents(ws);
    console.log(JSON.stringify(agents, null, 2));
    ws.close();
    return;
  }

  if (cmd === "attach") {
    const agentId = rest[0];
    if (!agentId) {
      usage();
      process.exit(1);
    }
    await attach(ws, agentId);
    console.log(`✅ attach ${agentId}. (Ctrl+C pour quitter)`);
    ws.on("message", (buf) => {
      let env;
      try {
        env = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (env.type === "cdp" && env.agentId === agentId) {
        console.log(env.message);
      }
    });
    return;
  }

  if (cmd === "navigate") {
    const [agentId, url] = rest;
    if (!agentId || !url) {
      usage();
      process.exit(1);
    }
    await attach(ws, agentId);
    const cdp = createCdpClient(ws, agentId);
    await cdp.send("Page.enable");
    const res = await cdp.send("Page.navigate", { url });
    console.log(JSON.stringify(res, null, 2));
    ws.close();
    return;
  }

  if (cmd === "eval") {
    const agentId = rest[0];
    const expr = rest.slice(1).join(" ");
    if (!agentId || !expr) {
      usage();
      process.exit(1);
    }
    await attach(ws, agentId);
    const cdp = createCdpClient(ws, agentId);
    await cdp.send("Runtime.enable");
    const res = await cdp.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
    });
    console.log(JSON.stringify(res, null, 2));
    ws.close();
    return;
  }

  usage();
  process.exit(1);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});

