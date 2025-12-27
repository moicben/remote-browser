const os = require("os");
const puppeteer = require("puppeteer");
const WebSocket = require("ws");
const { assertPinnedFingerprint } = require("../shared/tls-pinning");

const RELAY_IP = process.env.RELAY_IP || "109.176.198.25";
const RELAY_PORT = Number(process.env.RELAY_PORT || 4433);
const RELAY_BASE_URL =
  process.env.RELAY_URL || `wss://${RELAY_IP}:${RELAY_PORT}`;
const RELAY_AGENT_URL = `${RELAY_BASE_URL.replace(/\/$/, "")}/agent`;

const RELAY_CERT_FINGERPRINT256 = process.env.RELAY_CERT_FINGERPRINT256 || "";
const RELAY_INSECURE_SKIP_PINNING = process.env.RELAY_INSECURE_SKIP_PINNING === "1";

const DEFAULT_START_URL = "about:blank";
const CHROME_DEBUG_PORT = 9222;

function log(...args) {
  console.log(`[agent]`, ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getChromeBrowserWsUrl() {
  // Node 18+ fetch
  const res = await fetch(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`);
  if (!res.ok) throw new Error(`Erreur /json/version: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.webSocketDebuggerUrl) {
    throw new Error("webSocketDebuggerUrl manquant dans /json/version");
  }
  return data.webSocketDebuggerUrl;
}

async function startChrome() {
  log(`Démarrage Chrome (debug=${CHROME_DEBUG_PORT}, url=${DEFAULT_START_URL})`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    pipe: false,
    args: [
      `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());
  await page.goto(DEFAULT_START_URL);

  return browser;
}

function connectRelay() {
  log(`Connexion relay: ${RELAY_AGENT_URL}`);

  const ws = new WebSocket(RELAY_AGENT_URL, {
    rejectUnauthorized: false, // on fait le pinning nous-mêmes
  });

  ws.on("open", () => {
    try {
      if (!RELAY_INSECURE_SKIP_PINNING) {
        assertPinnedFingerprint(ws, RELAY_CERT_FINGERPRINT256);
      } else {
        log("⚠️  RELAY_INSECURE_SKIP_PINNING=1 (pinning désactivé)");
      }
      log("✅ Relay connecté (TLS OK)");
    } catch (e) {
      log("❌ TLS pinning a échoué:", e.message);
      ws.terminate();
    }
  });

  ws.on("error", (err) => log("Relay error:", err.message));
  ws.on("close", () => log("Relay closed"));

  // keepalive
  const pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 15000);
  ws.on("close", () => clearInterval(pingTimer));

  return ws;
}

function connectChromeCdp(wsUrl) {
  log(`Connexion CDP local: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);
  ws.on("open", () => log("✅ CDP connecté"));
  ws.on("error", (err) => log("CDP error:", err.message));
  ws.on("close", (code) => log(`CDP closed (code=${code})`));
  return ws;
}

async function main() {
  if (!RELAY_INSECURE_SKIP_PINNING && !RELAY_CERT_FINGERPRINT256) {
    throw new Error(
      "RELAY_CERT_FINGERPRINT256 requis (ou RELAY_INSECURE_SKIP_PINNING=1 pour dev)"
    );
  }

  const browser = await startChrome();

  // Attendre que le endpoint CDP soit prêt
  let chromeWsUrl = null;
  for (let i = 0; i < 30; i++) {
    try {
      chromeWsUrl = await getChromeBrowserWsUrl();
      break;
    } catch {
      await sleep(300);
    }
  }
  if (!chromeWsUrl) throw new Error("Chrome CDP indisponible (timeout)");

  const cdpWs = connectChromeCdp(chromeWsUrl);
  const relayWs = connectRelay();

  let agentId = null;

  relayWs.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    if (msg.type === "hello" && msg.agentId) {
      agentId = msg.agentId;
      log(`🆔 agentId = ${agentId}`);
      // envoyer meta
      if (relayWs.readyState === relayWs.OPEN) {
        relayWs.send(
          JSON.stringify({
            type: "meta",
            meta: {
              hostname: os.hostname(),
              platform: process.platform,
              arch: process.arch,
            },
          })
        );
      }
      return;
    }

    if (msg.type === "cdp" && typeof msg.message === "string") {
      if (cdpWs.readyState === cdpWs.OPEN) {
        cdpWs.send(msg.message);
      }
    }
  });

  cdpWs.on("message", (data) => {
    if (relayWs.readyState !== relayWs.OPEN) return;
    relayWs.send(
      JSON.stringify({
        type: "cdp",
        message: data.toString(),
      })
    );
  });

  async function shutdown() {
    log("Arrêt...");
    try {
      relayWs.close();
    } catch {}
    try {
      cdpWs.close();
    } catch {}
    try {
      await browser.close();
    } catch {}
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log("Agent prêt. Laisse ce process tourner.");
}

main().catch((e) => {
  console.error("[agent] ❌ Erreur fatale:", e.message);
  process.exit(1);
});

