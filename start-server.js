#!/usr/bin/env node

const { spawn } = require('child_process');
const http = require('http');
const readline = require('readline');

const SERVER_PORT = 3000;
const NGROK_PORT = 4040; // Port de l'interface web ngrok

let serverProcess = null;
let ngrokProcess = null;
let ngrokUrl = null;

// Fonction pour attendre que le serveur soit prêt
function waitForServer(port, maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const checkServer = () => {
      attempts++;
      const req = http.get(`http://localhost:${port}`, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error(`Le serveur n'a pas démarré après ${maxAttempts} tentatives`));
        } else {
          setTimeout(checkServer, 1000);
        }
      });
    };
    checkServer();
  });
}

// Fonction pour récupérer l'URL ngrok depuis l'API ngrok
async function getNgrokUrl() {
  return new Promise((resolve, reject) => {
    const maxAttempts = 30;
    let attempts = 0;
    
    const checkNgrok = () => {
      attempts++;
      const req = http.get(`http://localhost:${NGROK_PORT}/api/tunnels`, (res) => {
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
            if (attempts >= maxAttempts) {
              reject(new Error('Ngrok n\'a pas créé de tunnel HTTPS'));
            } else {
              setTimeout(checkNgrok, 1000);
            }
          } catch (error) {
            if (attempts >= maxAttempts) {
              reject(error);
            } else {
              setTimeout(checkNgrok, 1000);
            }
          }
        });
      });
      
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error('Impossible de se connecter à l\'API ngrok'));
        } else {
          setTimeout(checkNgrok, 1000);
        }
      });
    };
    
    checkNgrok();
  });
}

// Fonction pour nettoyer les processus
function cleanup() {
  console.log('\n\n🛑 Arrêt des processus...');
  
  if (ngrokProcess) {
    ngrokProcess.kill('SIGTERM');
    ngrokProcess = null;
  }
  
  if (serverProcess) {
    serverProcess.kill('SIGINT');
    serverProcess = null;
  }
  
  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

// Gestion des signaux d'arrêt
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

async function main() {
  console.log('🚀 Démarrage du serveur Chrome Remote Control...\n');
  
  // 1. Lancer le serveur Chrome
  console.log('1️⃣ Lancement du serveur Chrome...');
  serverProcess = spawn('npm', ['start'], {
    stdio: 'inherit',
    shell: true,
    cwd: __dirname
  });
  
  serverProcess.on('error', (error) => {
    console.error('❌ Erreur lors du lancement du serveur:', error);
    cleanup();
  });
  
  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`❌ Le serveur s'est arrêté avec le code ${code}`);
      cleanup();
    }
  });
  
  // Attendre que le serveur soit prêt
  try {
    await waitForServer(SERVER_PORT);
    console.log(`✅ Serveur Chrome démarré sur le port ${SERVER_PORT}\n`);
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    cleanup();
    return;
  }
  
  // 2. Lancer ngrok
  console.log('2️⃣ Lancement de ngrok...');
  ngrokProcess = spawn('ngrok', ['http', String(SERVER_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  
  ngrokProcess.on('error', (error) => {
    console.error('❌ Erreur lors du lancement de ngrok:', error.message);
    console.error('   Assurez-vous que ngrok est installé: brew install ngrok/ngrok/ngrok');
    cleanup();
  });
  
  ngrokProcess.stderr.on('data', (data) => {
    const output = data.toString();
    // Ignorer les warnings ngrok
    if (!output.includes('WARN') && !output.includes('level=info')) {
      process.stderr.write(data);
    }
  });
  
  // Attendre que ngrok soit prêt et récupérer l'URL
  try {
    ngrokUrl = await getNgrokUrl();
    console.log(`✅ Ngrok démarré`);
    console.log(`\n🌐 URL publique: ${ngrokUrl}`);
    console.log(`📊 Interface ngrok: http://localhost:${NGROK_PORT}\n`);
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    console.error('   Ngrok continue de tourner, mais l\'URL n\'a pas pu être récupérée.');
    console.error('   Vérifiez manuellement: http://localhost:4040\n');
  }
  
  // 3. Afficher les instructions
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Serveur prêt !');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (ngrokUrl) {
    console.log(`📍 URL ngrok: ${ngrokUrl}`);
    console.log(`🔌 URL Chrome DevTools: ${ngrokUrl}\n`);
  }
  
  console.log('📋 Commandes disponibles:');
  console.log('   npm run client              - Contrôler le navigateur via Puppeteer');
  console.log('   npm run client:websocket    - Contrôler via WebSocket');
  console.log('   npm run client:info         - Voir les informations du navigateur\n');
  
  console.log('⚠️  Pour arrêter le serveur, appuyez sur Ctrl+C\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Garder le processus actif
  // Le script reste actif jusqu'à ce qu'on appuie sur Ctrl+C
}

main().catch((error) => {
  console.error('❌ Erreur fatale:', error);
  cleanup();
});
