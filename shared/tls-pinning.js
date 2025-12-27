function normalizeFingerprint(fp) {
  if (!fp) return "";
  return String(fp).trim().toUpperCase().replace(/[^A-F0-9]/g, "");
}

function getPeerFingerprint256(ws) {
  // ws from `ws` library
  const sock = ws && ws._socket;
  if (!sock || typeof sock.getPeerCertificate !== "function") return null;
  const cert = sock.getPeerCertificate(true);
  if (!cert) return null;
  // Node exposes fingerprint256 like "AA:BB:..."
  return cert.fingerprint256 || null;
}

function assertPinnedFingerprint(ws, expectedFingerprint256) {
  const expectedNorm = normalizeFingerprint(expectedFingerprint256);
  if (!expectedNorm) {
    throw new Error("RELAY_CERT_FINGERPRINT256 manquant (pinning requis)");
  }
  const actual = getPeerFingerprint256(ws);
  if (!actual) {
    throw new Error("Impossible de lire le certificat TLS peer (pinning impossible)");
  }
  const actualNorm = normalizeFingerprint(actual);
  if (actualNorm !== expectedNorm) {
    throw new Error(
      `TLS pinning échoué: fingerprint mismatch.\n` +
        `- expected: ${expectedFingerprint256}\n` +
        `- actual  : ${actual}`
    );
  }
}

module.exports = {
  normalizeFingerprint,
  getPeerFingerprint256,
  assertPinnedFingerprint,
};

