#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CERT_DIR = path.join(__dirname, "cert");
const KEY_PATH = path.join(CERT_DIR, "key.pem");
const CERT_PATH = path.join(CERT_DIR, "cert.pem");

const IP = process.env.RELAY_IP || "109.176.198.25";
const DAYS = process.env.RELAY_CERT_DAYS || "3650";

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
}

function fingerprint256FromPem(pem) {
  // DER = base64 decoded content between PEM markers
  const b64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(b64, "base64");
  const hash = crypto.createHash("sha256").update(der).digest("hex").toUpperCase();
  // format AA:BB:...
  return hash.match(/.{2}/g).join(":");
}

function main() {
  fs.mkdirSync(CERT_DIR, { recursive: true });

  if (fs.existsSync(KEY_PATH) || fs.existsSync(CERT_PATH)) {
    console.log(`⚠️  Des fichiers existent déjà dans ${CERT_DIR}`);
    console.log(`   Supprime-les si tu veux régénérer : rm -rf ${CERT_DIR}`);
  }

  // On utilise openssl pour générer un cert auto-signé avec SAN IP
  // (la plupart des distros ont openssl installé par défaut)
  const subj = `/CN=${IP}`;

  console.log(`Génération cert auto-signé pour IP=${IP} (validité ${DAYS} jours)`);

  // openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 \
  //   -subj "/CN=109.176.198.25" -addext "subjectAltName = IP:109.176.198.25"
  sh("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    KEY_PATH,
    "-out",
    CERT_PATH,
    "-days",
    String(DAYS),
    "-subj",
    subj,
    "-addext",
    `subjectAltName = IP:${IP}`,
  ]);

  const certPem = fs.readFileSync(CERT_PATH, "utf8");
  const fp = fingerprint256FromPem(certPem);

  console.log("\n✅ Cert généré :");
  console.log(`- key : ${KEY_PATH}`);
  console.log(`- cert: ${CERT_PATH}`);
  console.log("\n🔒 Fingerprint (SHA-256) à pinner :");
  console.log(fp);
  console.log("\nExemples :");
  console.log(`- mac/pc agent: RELAY_CERT_FINGERPRINT256='${fp}'`);
  console.log(`- vps cli     : RELAY_CERT_FINGERPRINT256='${fp}'`);
}

main();

