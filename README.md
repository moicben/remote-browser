# Chrome Remote Control

⚠️ **ATTENTION : SÉCURITÉ CRITIQUE** ⚠️

Ce script expose votre navigateur Chrome localement et peut être rendu accessible publiquement sur Internet. **C'est extrêmement dangereux** car n'importe qui peut :

- Contrôler votre navigateur
- Accéder à vos sessions authentifiées
- Voler vos données personnelles
- Effectuer des actions malveillantes en votre nom

## ⚠️ AVERTISSEMENTS DE SÉCURITÉ

1. **NE JAMAIS utiliser ce script en production sans authentification**
2. **NE JAMAIS exposer ce serveur directement sur Internet sans protection**
3. **Utilisez uniquement dans un environnement de test isolé**
4. **Configurez un pare-feu pour limiter l'accès**
5. **Utilisez HTTPS et authentification si vous devez l'exposer**

## Installation

Les dépendances sont déjà installées. Si besoin :

```bash
npm install
```

## Utilisation

### 🚀 Méthode recommandée : Script automatique

Le moyen le plus simple est d'utiliser le script `start-server.js` qui lance automatiquement le serveur ET ngrok :

```bash
npm run serve
```

Ce script va :
1. ✅ Lancer Chrome avec le débogage à distance activé
2. ✅ Créer un serveur HTTP sur le port 3000
3. ✅ Lancer automatiquement ngrok pour exposer le serveur publiquement
4. ✅ Récupérer et afficher l'URL ngrok publique
5. ✅ Afficher les commandes disponibles pour contrôler le navigateur

Une fois le serveur lancé, vous pouvez utiliser le client dans un autre terminal :

```bash
npm run client
```

Le client récupérera automatiquement l'URL ngrok depuis l'API ngrok, donc pas besoin de la configurer manuellement !

### Méthode manuelle (ancienne méthode)

Si vous préférez lancer les processus séparément :

```bash
# Terminal 1 : Lancer le script
npm start

# Terminal 2 : Exposer avec ngrok (nécessite un compte ngrok)
ngrok http 3000
```

### Accès local

- Interface web : http://localhost:3000
- Chrome DevTools : http://localhost:9222
- Interface ngrok : http://localhost:4040

### Exposition publique directe (DANGEREUX)

Si vous voulez exposer directement (non recommandé) :

1. Configurez votre routeur pour le port forwarding du port 3000
2. Trouvez votre IP publique
3. Le serveur sera accessible sur `http://VOTRE_IP_PUBLIQUE:3000`

**⚠️ N'oubliez pas de configurer un pare-feu !**

## Commandes disponibles

### Serveur

- `npm run serve` - Lance le serveur Chrome ET ngrok automatiquement (recommandé)
- `npm start` - Lance uniquement le serveur Chrome (nécessite ngrok séparément)

### Client

- `npm run client` ou `npm run client:puppeteer` - Contrôler le navigateur via Puppeteer (recommandé)
- `npm run client:websocket` - Contrôler via WebSocket direct
- `npm run client:info` - Afficher les informations du navigateur (pages ouvertes, etc.)

## Utilisation depuis une VM distante

Pour contrôler le navigateur depuis une VM distante ou un autre appareil :

### Sur votre appareil local :
```bash
npm run serve
# Notez l'URL ngrok affichée, ex: https://xxxx.ngrok-free.dev
```

### Sur la VM distante :

1. **Clonez ou copiez le projet** :
   ```bash
   git clone <votre-repo> chrome-client
   cd chrome-client
   npm install
   ```

2. **Définissez l'URL ngrok et lancez le client** :
   ```bash
   export NGROK_URL='https://xxxx.ngrok-free.dev'
   npm run client
   ```

Le client utilisera automatiquement l'URL ngrok depuis la variable d'environnement.

## Configuration

Vous pouvez modifier le port en définissant la variable d'environnement :

```bash
PORT=8080 npm start
```

Pour utiliser une URL ngrok spécifique depuis le client :

```bash
export NGROK_URL='https://votre-url.ngrok-free.dev'
npm run client
```

## Arrêt

Pour le script automatique (`npm run serve`), appuyez sur `Ctrl+C` pour arrêter proprement :
- Le serveur Chrome
- Ngrok
- Tous les processus associés

## Sécurité recommandée

Pour une utilisation plus sécurisée, considérez :

1. **Authentification** : Ajoutez une authentification basique HTTP
2. **HTTPS** : Utilisez un reverse proxy avec SSL (nginx, Caddy)
3. **Whitelist IP** : Limitez l'accès à certaines adresses IP
4. **VPN** : Utilisez un VPN au lieu d'exposer directement
5. **Isolation** : Exécutez dans un conteneur Docker isolé

## Exemple avec authentification basique

Pour ajouter une authentification basique, vous pouvez modifier le script pour inclure :

```javascript
const basicAuth = require('express-basic-auth');

app.use(basicAuth({
  users: { 'admin': 'motdepasse' },
  challenge: true
}));
```

## Licence

ISC
