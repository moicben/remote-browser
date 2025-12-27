const puppeteer = require('puppeteer');
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = process.env.PORT || 3000;
const CHROME_DEBUG_PORT = 9222;

console.log('⚠️  AVERTISSEMENT DE SÉCURITÉ ⚠️');
console.log('Ce script expose votre navigateur Chrome publiquement sur Internet.');
console.log('N\'importe qui peut contrôler votre navigateur et accéder à vos données.');
console.log('Utilisez uniquement dans un environnement de test sécurisé !\n');

let browser = null;

async function startChrome() {
  console.log('🚀 Lancement de Chrome avec débogage à distance...');
  
  browser = await puppeteer.launch({
    headless: false, // Affiche le navigateur
    defaultViewport: null,
    args: [
      `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    ignoreDefaultArgs: ['--disable-extensions'],
  });

  console.log(`✅ Chrome lancé avec succès sur le port ${CHROME_DEBUG_PORT}`);
  return browser;
}

function createServer() {
  const app = express();

  // Page d'accueil avec informations
  app.get('/', (req, res) => {
    res.send(`
      <html>
        <head>
          <title>Chrome Remote Control</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; }
            .warning { background: #fff3cd; border: 2px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .info { background: #d1ecf1; border: 2px solid #0c5460; padding: 15px; border-radius: 5px; margin: 20px 0; }
            code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
            a { color: #007bff; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🌐 Chrome Remote Control</h1>
            <div class="warning">
              <strong>⚠️ ATTENTION :</strong> Ce serveur expose votre navigateur Chrome publiquement.
              N'importe qui ayant accès à cette URL peut contrôler votre navigateur.
            </div>
            <div class="info">
              <h3>Informations de connexion :</h3>
              <p><strong>Port de débogage Chrome :</strong> <code>${CHROME_DEBUG_PORT}</code></p>
              <p><strong>Port du serveur :</strong> <code>${PORT}</code></p>
              <p><strong>URL de débogage :</strong> <a href="http://localhost:${CHROME_DEBUG_PORT}" target="_blank">http://localhost:${CHROME_DEBUG_PORT}</a></p>
            </div>
            <h3>Comment utiliser :</h3>
            <ol>
              <li>Accédez à <code>http://localhost:${CHROME_DEBUG_PORT}</code> pour voir les pages ouvertes</li>
              <li>Utilisez Chrome DevTools Protocol pour contrôler le navigateur</li>
              <li>Ou connectez-vous via WebSocket sur <code>ws://localhost:${CHROME_DEBUG_PORT}</code></li>
            </ol>
            <p><strong>Pour exposer publiquement :</strong></p>
            <ul>
              <li>Utilisez un service comme ngrok : <code>ngrok http ${PORT}</code></li>
              <li>Ou configurez le port forwarding sur votre routeur</li>
            </ul>
          </div>
        </body>
      </html>
    `);
  });

  // Proxy manuel pour le Chrome DevTools Protocol
  // Puppeteer a besoin d'accéder à /json, /json/version, /json/list, etc.
  app.use((req, res, next) => {
    // Vérifier si la requête commence par /json
    if (req.path.startsWith('/json')) {
      // Utiliser req.originalUrl pour avoir le chemin complet avec query string
      const targetPath = req.originalUrl || req.url;
      const targetUrl = `http://localhost:${CHROME_DEBUG_PORT}${targetPath}`;
      console.log(`📥 Proxy: ${req.method} ${targetPath} -> ${targetUrl}`);
      
      // Détecter l'URL publique (ngrok) depuis les headers de la requête
      // ngrok passe souvent X-Forwarded-Proto et X-Forwarded-Host
      const protocol = req.get('x-forwarded-proto') || req.protocol || (req.secure ? 'https' : 'http');
      const host = req.get('x-forwarded-host') || req.get('host') || req.headers.host;
      const publicBaseUrl = host ? `${protocol}://${host}` : null;
      
      fetch(targetUrl)
        .then(response => {
          return response.text().then(data => ({ response, data }));
        })
        .then(({ response, data }) => {
          // Si c'est une réponse JSON et qu'on a une URL publique, remplacer les URLs WebSocket
          if (publicBaseUrl && response.headers.get('content-type')?.includes('application/json')) {
            try {
              const jsonData = JSON.parse(data);
              
              // Fonction pour convertir les URLs WebSocket localhost en URLs publiques
              const convertWebSocketUrl = (wsUrl) => {
                if (!wsUrl || typeof wsUrl !== 'string') return wsUrl;
                // Remplacer ws://localhost:9222 par wss://ngrok-url
                if (wsUrl.startsWith('ws://localhost:9222')) {
                  const wsPath = wsUrl.replace('ws://localhost:9222', '');
                  return publicBaseUrl.replace('http://', 'wss://').replace('https://', 'wss://') + wsPath;
                }
                return wsUrl;
              };
              
              // Si c'est un tableau (comme /json)
              if (Array.isArray(jsonData)) {
                jsonData.forEach(item => {
                  if (item.webSocketDebuggerUrl) {
                    item.webSocketDebuggerUrl = convertWebSocketUrl(item.webSocketDebuggerUrl);
                  }
                  if (item.devtoolsFrontendUrl) {
                    // Mettre à jour aussi devtoolsFrontendUrl pour utiliser l'URL publique
                    item.devtoolsFrontendUrl = item.devtoolsFrontendUrl.replace(
                      /ws=localhost:9222/g,
                      `ws=${publicBaseUrl.replace('http://', 'wss://').replace('https://', 'wss://')}`
                    );
                  }
                });
                data = JSON.stringify(jsonData);
              }
              // Si c'est un objet (comme /json/version)
              else if (typeof jsonData === 'object' && jsonData !== null) {
                if (jsonData.webSocketDebuggerUrl) {
                  jsonData.webSocketDebuggerUrl = convertWebSocketUrl(jsonData.webSocketDebuggerUrl);
                }
                data = JSON.stringify(jsonData);
              }
            } catch (e) {
              // Si ce n'est pas du JSON valide ou erreur de parsing, garder les données originales
              console.log('⚠️  Impossible de modifier les URLs WebSocket:', e.message);
            }
          }
          
          // Copier les headers de la réponse
          res.status(response.status);
          response.headers.forEach((value, key) => {
            // Ignorer certains headers qui peuvent causer des problèmes
            if (!['connection', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
              res.setHeader(key, value);
            }
          });
          
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/json; charset=UTF-8');
          }
          res.send(data);
          console.log(`📤 Proxy réponse: ${response.status} pour ${targetPath}`);
        })
        .catch(error => {
          console.error(`❌ Erreur proxy pour ${targetPath}:`, error.message);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Proxy error', message: error.message });
          }
        });
    } else {
      // Passer à la route suivante si ce n'est pas /json
      next();
    }
  });

  // Proxy WebSocket pour DevTools (géré par WebSocketServer ci-dessous)
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const targetUrl = `ws://localhost:${CHROME_DEBUG_PORT}${req.url}`;
    console.log(`📡 Connexion WebSocket depuis ${req.socket.remoteAddress} vers ${targetUrl}`);
    
    const target = new WebSocket(targetUrl);
    
    ws.on('message', (data) => {
      target.send(data);
    });
    
    target.on('message', (data) => {
      ws.send(data);
    });
    
    ws.on('close', () => {
      target.close();
    });
    
    target.on('close', () => {
      ws.close();
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Serveur démarré sur http://0.0.0.0:${PORT}`);
    console.log(`🌍 Accessible publiquement sur toutes les interfaces réseau`);
    console.log(`\n⚠️  RAPPEL : Ce serveur est accessible par TOUT LE MONDE sur Internet !`);
    console.log(`   Assurez-vous d'avoir configuré un pare-feu ou une authentification.\n`);
  });

  return server;
}

async function main() {
  try {
    await startChrome();
    createServer();
    
    // Gestion de l'arrêt propre
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Arrêt du serveur...');
      if (browser) {
        await browser.close();
      }
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Erreur:', error);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

main();
