const puppeteer = require('puppeteer-core');
const WebSocket = require('ws');
const http = require('http');

const CHROME_DEBUG_PORT = 9222;
const NGROK_API_PORT = 4040;

// Fonction pour récupérer automatiquement l'URL ngrok depuis l'API ngrok
async function getNgrokUrl() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${NGROK_API_PORT}/api/tunnels`, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const tunnels = JSON.parse(data);
          if (tunnels.tunnels && tunnels.tunnels.length > 0) {
            const httpsTunnel = tunnels.tunnels.find(t => t.proto === 'https');
            if (httpsTunnel) {
              resolve(httpsTunnel.public_url);
              return;
            }
          }
          reject(new Error('Aucun tunnel HTTPS trouvé'));
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', () => {
      reject(new Error('Impossible de se connecter à l\'API ngrok. Assurez-vous que ngrok est lancé.'));
    });
    
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('Timeout lors de la connexion à l\'API ngrok'));
    });
  });
}

// Configuration - récupération automatique de l'URL ngrok
let NGROK_URL = null;
let CHROME_DEBUG_URL = null;

// Pour connexion locale uniquement, décommentez cette ligne :
// CHROME_DEBUG_URL = `http://localhost:${CHROME_DEBUG_PORT}`;

/**
 * Méthode 1: Connexion Puppeteer (nécessite l'exposition du port 9222)
 */
async function connectWithPuppeteer() {
  try {
    console.log('🔌 Connexion au navigateur via Puppeteer...');
    
    const browser = await puppeteer.connect({
      browserURL: CHROME_DEBUG_URL,
      defaultViewport: null
    });
    
    const pages = await browser.pages();
    console.log(`✅ Connecté ! ${pages.length} page(s) ouverte(s)`);
    
    let page = pages[0];
    if (!page) {
      page = await browser.newPage();
      console.log('📄 Nouvelle page créée');
    }
    
    return { browser, page };
  } catch (error) {
    console.error('❌ Erreur de connexion Puppeteer:', error.message);
    throw error;
  }
}

/**
 * Méthode 2: Récupérer les informations via l'API REST ngrok
 */
async function getBrowserInfo() {
  try {
    const url = NGROK_URL || CHROME_DEBUG_URL;
    if (!url) {
      throw new Error('URL ngrok non configurée');
    }
    const response = await fetch(`${url}/json`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des infos:', error.message);
    throw error;
  }
}

/**
 * Méthode 3: Contrôle via WebSocket direct
 */
async function controlViaWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let commandId = 1;
    const responses = new Map();
    
    ws.on('open', () => {
      console.log('✅ Connecté via WebSocket');
      resolve({ ws, commandId: () => commandId++, responses });
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.id) {
          responses.set(message.id, message);
        } else {
          console.log('📨 Message:', message);
        }
      } catch (e) {
        console.log('📨 Message brut:', data.toString());
      }
    });
    
    ws.on('error', reject);
  });
}

/**
 * Exécuter une commande Chrome DevTools Protocol
 */
async function sendCommand(wsControl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = wsControl.commandId();
    const command = { id, method, params };
    
    wsControl.responses.set(id, null);
    wsControl.ws.send(JSON.stringify(command));
    
    // Attendre la réponse
    const checkResponse = setInterval(() => {
      const response = wsControl.responses.get(id);
      if (response !== null) {
        clearInterval(checkResponse);
        wsControl.responses.delete(id);
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      }
    }, 100);
    
    // Timeout après 5 secondes
    setTimeout(() => {
      clearInterval(checkResponse);
      wsControl.responses.delete(id);
      reject(new Error('Timeout'));
    }, 5000);
  });
}

/**
 * Exemple d'utilisation avec Puppeteer
 */
async function exampleWithPuppeteer() {
  try {
    const { browser, page } = await connectWithPuppeteer();
    
    console.log('\n📋 Exemples de contrôle :\n');
    
    // 1. Naviguer vers une URL
    console.log('1️⃣ Navigation vers Google...');
    await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
    console.log('   ✅ Page chargée:', await page.url());
    
    // 2. Prendre une capture d'écran
    console.log('\n2️⃣ Capture d\'écran...');
    await page.screenshot({ path: 'screenshot-remote.png', fullPage: false });
    console.log('   ✅ Capture sauvegardée: screenshot-remote.png');
    
    // 3. Récupérer le titre
    console.log('\n3️⃣ Récupération du titre...');
    const title = await page.title();
    console.log('   ✅ Titre:', title);
    
    // 4. Exécuter du JavaScript
    console.log('\n4️⃣ Exécution de JavaScript...');
    const result = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        userAgent: navigator.userAgent
      };
    });
    console.log('   ✅ Résultat:', result);
    
    // 5. Recherche sur Google (exemple)
    console.log('\n5️⃣ Recherche sur Google...');
    await page.type('textarea[name="q"]', 'Boss que je suis !');
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('   ✅ Recherche effectuée');
    
    // Ne pas fermer le navigateur, juste se déconnecter
    browser.disconnect();
    console.log('\n✅ Déconnexion réussie');
    
  } catch (error) {
    console.error('\n❌ Erreur:', error.message);
    process.exit(1);
  }
}

/**
 * Exemple d'utilisation avec WebSocket direct
 */
async function exampleWithWebSocket() {
  try {
    console.log('📡 Récupération des informations du navigateur...');
    const targets = await getBrowserInfo();
    
    if (targets.length === 0) {
      console.log('⚠️  Aucune page ouverte. Veuillez ouvrir une page dans Chrome.');
      return;
    }
    
    const target = targets[0];
    console.log(`✅ Page trouvée: ${target.url}`);
    console.log(`🔗 WebSocket URL: ${target.webSocketDebuggerUrl}`);
    
    // Convertir l'URL WebSocket pour utiliser ngrok via le proxy du serveur
    let wsUrl = target.webSocketDebuggerUrl;
    
    // Si on utilise ngrok (URL HTTPS), convertir l'URL WebSocket
    const debugUrl = CHROME_DEBUG_URL || NGROK_URL;
    if (debugUrl && debugUrl.startsWith('https://')) {
      // Extraire le chemin de l'URL WebSocket (ex: /devtools/page/...)
      const wsPath = new URL(wsUrl).pathname;
      // Utiliser le proxy WebSocket du serveur via ngrok
      wsUrl = debugUrl.replace('https://', 'wss://') + wsPath;
      console.log(`🔄 URL WebSocket convertie pour ngrok: ${wsUrl}`);
    }
    
    const wsControl = await controlViaWebSocket(wsUrl);
    
    console.log('\n📋 Exemples de contrôle via WebSocket :\n');
    
    // Exemple: Naviguer vers une URL
    console.log('1️⃣ Navigation vers example.com...');
    const navResult = await sendCommand(wsControl, 'Page.navigate', {
      url: 'https://example.com'
    });
    console.log('   ✅ Navigation réussie');
    
    // Attendre que la page se charge
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Exemple: Prendre une capture d'écran
    console.log('\n2️⃣ Capture d\'écran...');
    const screenshot = await sendCommand(wsControl, 'Page.captureScreenshot', {
      format: 'png'
    });
    
    // Sauvegarder la capture
    const fs = require('fs');
    fs.writeFileSync('screenshot-websocket.png', screenshot.data, 'base64');
    console.log('   ✅ Capture sauvegardée: screenshot-websocket.png');
    
    // Exemple: Récupérer le titre
    console.log('\n3️⃣ Récupération du titre...');
    const titleResult = await sendCommand(wsControl, 'Runtime.evaluate', {
      expression: 'document.title'
    });
    console.log('   ✅ Titre:', titleResult.result.value);
    
    wsControl.ws.close();
    console.log('\n✅ Déconnexion réussie');
    
  } catch (error) {
    console.error('\n❌ Erreur:', error.message);
    process.exit(1);
  }
}

// Menu principal
async function main() {
  const method = process.argv[2] || 'puppeteer';
  
  // Vérifier d'abord la variable d'environnement (pour utilisation distante)
  if (process.env.NGROK_URL && !CHROME_DEBUG_URL) {
    NGROK_URL = process.env.NGROK_URL;
    CHROME_DEBUG_URL = NGROK_URL;
    console.log(`✅ URL ngrok depuis variable d'environnement: ${NGROK_URL}\n`);
  }
  // Sinon, récupérer automatiquement l'URL ngrok si elle n'est pas définie
  else if (!CHROME_DEBUG_URL) {
    try {
      console.log('🔍 Récupération de l\'URL ngrok depuis l\'API ngrok...\n');
      NGROK_URL = await getNgrokUrl();
      CHROME_DEBUG_URL = NGROK_URL;
      console.log(`✅ URL ngrok détectée: ${NGROK_URL}\n`);
    } catch (error) {
      console.error('⚠️  Impossible de récupérer l\'URL ngrok automatiquement.');
      console.error(`   ${error.message}\n`);
      console.error('💡 Solutions:');
      console.error('   1. Définissez la variable d\'environnement: export NGROK_URL="https://votre-url.ngrok-free.dev"');
      console.error('   2. Assurez-vous que ngrok est lancé (via npm run serve)');
      console.error('   3. Ou modifiez CHROME_DEBUG_URL dans client-remote.js');
      console.error('   4. Ou utilisez la connexion locale en décommentant la ligne dans le code\n');
      process.exit(1);
    }
  }
  
  console.log('🌐 Client de contrôle Chrome à distance\n');
  console.log(`📍 URL ngrok: ${NGROK_URL || 'Non configurée'}`);
  console.log(`🔌 URL Chrome DevTools: ${CHROME_DEBUG_URL}\n`);
  
  if (method === 'puppeteer') {
    console.log('📦 Utilisation de Puppeteer (recommandé)\n');
    await exampleWithPuppeteer();
  } else if (method === 'websocket') {
    console.log('📡 Utilisation de WebSocket direct\n');
    await exampleWithWebSocket();
  } else if (method === 'info') {
    console.log('ℹ️  Récupération des informations\n');
    const info = await getBrowserInfo();
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log('Usage:');
    console.log('  node client-remote.js [method]');
    console.log('');
    console.log('  method: puppeteer (défaut), websocket, ou info');
    console.log('');
    console.log('Exemples:');
    console.log('  npm run client                    - Utiliser Puppeteer (détection auto)');
    console.log('  npm run client websocket           - Utiliser WebSocket');
    console.log('  npm run client info                - Afficher les infos');
    console.log('');
    console.log('Pour utilisation distante (VM, serveur, etc.):');
    console.log('  export NGROK_URL="https://xxxx.ngrok-free.dev"');
    console.log('  npm run client');
  }
}

main();
