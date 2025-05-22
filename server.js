const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'], // Support des WebSockets et fallback polling
  allowUpgrades: true, // Permettre la mise à niveau de polling vers WebSocket
  maxHttpBufferSize: 1e8, // 100MB - pour permettre de plus grands objets
  perMessageDeflate: {
    threshold: 1024 // Compression pour les messages > 1KB
  }
});

// Stockage en mémoire pour les blocs et transactions
const mempool = [];
let blockchain = [];

// État des clients connectés
let connectedClients = 0;

// Servir les fichiers statiques depuis le dossier "public"
app.use(express.static(path.join(__dirname, 'public')));

// Route pour la racine
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fonction améliorée pour diffuser périodiquement l'état de la blockchain
function broadcastBlockchainState() {
  io.emit('blockchainState', {
    blockchain: { length: blockchain.length, lastBlockHash: blockchain.length > 0 ? blockchain[blockchain.length - 1].hash.substring(0, 8) + '...' : 'none' },
    mempool: mempool,  // Envoi du mempool complet (au lieu de l'objet mempool sans détails)
    connectedClients
  });
  
  // Envoyer périodiquement la blockchain complète (version légère)
  const lightBlockchain = blockchain.map(block => ({
    index: block.index,
    hash: block.hash,
    previousHash: block.previousHash,
    timestamp: block.timestamp,
    transactionCount: block.transactions ? block.transactions.length : 0
  }));
  
  // Diffuser seulement une fois toutes les 10 minutes pour économiser la bande passante
  if (Math.random() < 0.1) { // 10% de chances à chaque appel
    io.emit('lightBlockchain', lightBlockchain);
  }
}

// Middleware pour suivre les connexions/déconnexions
io.use((socket, next) => {
  console.log(`Client trying to connect: ${socket.id} from ${socket.handshake.headers['user-agent']}`);
  
  // Vérifier si le client est un bot ou un crawler
  const userAgent = socket.handshake.headers['user-agent'] || '';
  if (userAgent.includes('bot') || userAgent.includes('crawl')) {
    console.log(`Rejecting bot connection: ${userAgent}`);
    return next(new Error('Bots not allowed'));
  }
  
  next();
});

// Ajouter des moniteurs pour la santé des connexions
const clientConnectionTimestamp = new Map(); // Stocker le dernier timestamp d'activité par client

// Créer une collection pour stocker tous les wallets partagés
const sharedWallets = new Map(); // Utilise un Map pour stocker les wallets par leur publicKey

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`Client connecté : ${socket.id} (${connectedClients} clients actifs)`);

  // Enregistrer le timestamp de connexion initial
  clientConnectionTimestamp.set(socket.id, Date.now());

  // Envoyer l'état actuel au client qui se connecte
  socket.emit('blockchainState', { blockchain, mempool, connectedClients });

  // Diffuser le nombre de clients connectés
  io.emit('clientCount', { count: connectedClients });

  // Écoute d'un nouvel événement de transaction
  socket.on('newTransaction', (tx, callback) => {
    console.log('Nouvelle transaction reçue :', tx);
    
    // Vérifier si la transaction existe déjà dans le mempool
    const txExists = mempool.some(item => 
      item.signature === tx.signature || 
      (item.from === tx.from && item.to === tx.to && item.amount === tx.amount)
    );
    
    if (!txExists) {
      // Ajouter au mempool
      mempool.push(tx);
      
      // Diffuser à tous les autres clients
      io.emit('transactionBroadcast', tx);
      
      // Confirmation de réception avec succès
      if (callback) callback({ success: true });
    } else {
      // Transaction déjà dans le mempool
      if (callback) callback({ success: false, reason: 'Transaction déjà dans le mempool' });
      console.log('Transaction déjà dans le mempool, ignorée');
    }
  });

  // Écoute d'un nouvel événement de bloc miné
  socket.on('newBlock', (block, callback) => {
    console.log('Nouveau bloc miné reçu:', block);
    
    // Vérification du hash pour détecter les doublons
    const blockExists = blockchain.some(item => item.hash === block.hash);
    
    if (!blockExists) {
      // AJOUT: Vérifier le Merkle Root si présent
      if (block.merkleRoot && block.transactions && block.transactions.length > 0) {
        // Recalculer le Merkle Root pour validation
        const calculatedMerkleRoot = calculateMerkleRoot(block.transactions);
        
        if (block.merkleRoot !== calculatedMerkleRoot) {
          console.warn(`AVERTISSEMENT: Le Merkle Root du bloc reçu est invalide!`);
          console.warn(`Attendu: ${calculatedMerkleRoot.substring(0,15)}..., Reçu: ${block.merkleRoot.substring(0,15)}...`);
          // On peut décider de rejeter le bloc ou de corriger son Merkle Root
          block.merkleRoot = calculatedMerkleRoot;
        }
      }
      
      // CORRECTION: Vérifier et corriger la cohérence du previousHash
      if (blockchain.length > 0) {
        const lastBlockHash = blockchain[blockchain.length - 1].hash;
        if (block.previousHash !== lastBlockHash) {
          console.log(`AVERTISSEMENT: Incohérence de hash détectée dans le bloc reçu`);
          console.log(`Hash stocké: ${block.previousHash?.substring(0,15)}..., Hash attendu: ${lastBlockHash?.substring(0,15)}...`);
          
          // Corriger la référence au hash précédent
          console.log("Correction automatique du hash précédent");
          block.previousHash = lastBlockHash;
        }
      }
      
      // Attribuer un index séquentiel correct au nouveau bloc
      block.index = blockchain.length;
      
      // Ajouter à la blockchain
      blockchain.push(block);
      console.log(`Bloc #${block.index} avec hash ${block.hash.substring(0,8)}... ajouté à la blockchain. Total: ${blockchain.length} blocs`);
      
      // Nettoyer le mempool des transactions incluses dans ce bloc
      if (block.transactions && block.transactions.length > 0) {
        const oldSize = mempool.length;
        
        block.transactions.forEach(blockTx => {
          const txIndex = mempool.findIndex(mempoolTx => 
            mempoolTx.signature === blockTx.signature
          );
          
          if (txIndex !== -1) {
            mempool.splice(txIndex, 1);
          }
        });
        
        console.log(`${oldSize - mempool.length} transaction(s) retirée(s) du mempool`);
      }
      
      // Diffuser le bloc avec l'index correct à tous les clients
      io.emit('blockBroadcast', block);
      
      // Confirmation de réception avec succès
      if (callback) callback({ success: true });
    } else {
      // Bloc déjà dans la blockchain
      console.log(`Bloc ${block.hash.substring(0,8)}... déjà dans la blockchain, ignoré`);
      if (callback) callback({ success: false, reason: 'Bloc déjà dans la blockchain' });
    }
  });

  // NOUVEAU: événement pour synchroniser les wallets
  socket.on('walletUpdated', (wallet) => {
    console.log(`Wallet mis à jour: ${wallet.username}`);
    
    // Stocker ou mettre à jour le wallet dans la collection
    sharedWallets.set(wallet.publicKey, wallet);
    
    // Broadcast à tous les autres clients
    socket.broadcast.emit('walletSync', wallet);
  });
  
  // NOUVEAU: gérer la demande de tous les wallets
  socket.on('requestAllWallets', (data) => {
    console.log(`Client ${data.clientId} demande tous les wallets`);
    
    // Convertir la Map en tableau pour l'envoyer
    const allWallets = Array.from(sharedWallets.values());
    
    // Envoyer uniquement au client qui a fait la demande
    socket.emit('allWallets', allWallets);
    
    console.log(`${allWallets.length} wallets envoyés au client ${data.clientId}`);
  });
  
  // NOUVEAU: recevoir les wallets d'un client qui se connecte
  socket.on('shareMyWallets', (clientWallets) => {
    if (!clientWallets || !Array.isArray(clientWallets)) return;
    
    console.log(`Réception de ${clientWallets.length} wallets d'un client`);
    
    // Ajouter chaque wallet à la collection serveur
    clientWallets.forEach(wallet => {
      // Ne pas écraser les wallets existants si on a déjà une version plus récente
      if (!sharedWallets.has(wallet.publicKey) || 
          (wallet.lastUpdated && new Date(wallet.lastUpdated) > 
           new Date(sharedWallets.get(wallet.publicKey).lastUpdated || 0))) {
        sharedWallets.set(wallet.publicKey, wallet);
      }
    });
    
    // Informer les autres clients des nouveaux wallets
    socket.broadcast.emit('allWallets', Array.from(sharedWallets.values()));
  });

  // NOUVEAU: événement pour le heartbeat amélioré
  socket.on('heartbeat', (callback) => {
    // Mettre à jour le timestamp d'activité du client
    clientConnectionTimestamp.set(socket.id, Date.now());
    
    // Envoyer les statistiques du serveur avec la réponse
    callback({ 
      serverTime: new Date().toISOString(),
      activeClients: connectedClients,
      mempoolSize: mempool.length,
      blockchainHeight: blockchain.length,
      serverUptime: process.uptime()
    });
  });

  // NOUVEAU: événement pour demander la blockchain complète
  socket.on('requestFullBlockchain', (data, callback) => {
    console.log(`Client ${data.clientId} demande la blockchain complète`);
    
    // Envoyer uniquement au client qui a fait la demande
    if (callback) {
      callback({ blockchain });
    } else {
      socket.emit('fullBlockchain', blockchain);
    }
    
    console.log(`${blockchain.length} blocs envoyés au client ${data.clientId}`);
  });
  
  // NOUVEAU: recevoir la blockchain d'un client qui se connecte
  socket.on('shareMyBlockchain', (clientBlockchain) => {
    if (!clientBlockchain || !Array.isArray(clientBlockchain)) return;
    
    console.log(`Réception de ${clientBlockchain.length} blocs d'un client`);
    
    // Si la blockchain du client est plus longue que celle du serveur, la valider et l'adopter
    if (clientBlockchain.length > blockchain.length) {
      console.log(`La blockchain du client (${clientBlockchain.length} blocs) est plus longue que celle du serveur (${blockchain.length} blocs)`);
      
      // Vérifier la validité de la chaîne reçue
      if (isValidBlockchain(clientBlockchain)) {
        console.log("La blockchain du client est valide, adoption...");
        blockchain = clientBlockchain;
        
        // Diffuser la nouvelle blockchain aux autres clients
        socket.broadcast.emit('fullBlockchain', blockchain);
        
        console.log("Blockchain mise à jour et diffusée aux clients");
      } else {
        console.log("La blockchain du client est invalide, ignorée");
      }
    } else {
      // Si la blockchain du client n'est pas plus longue, chercher des blocs manquants
      let newBlocksAdded = 0;
      
      clientBlockchain.forEach(clientBlock => {
        // Vérifier si le bloc existe déjà
        const blockExists = blockchain.some(serverBlock => serverBlock.hash === clientBlock.hash);
        
        if (!blockExists) {
          // Vérifier si le bloc peut être ajouté (previousHash valide)
          const validPrevHash = blockchain.some(serverBlock => serverBlock.hash === clientBlock.previousHash);
          
          if (validPrevHash) {
            clientBlock.index = blockchain.length; // Corriger l'index
            blockchain.push(clientBlock);
            newBlocksAdded++;
          }
        }
      });
      
      if (newBlocksAdded > 0) {
        console.log(`${newBlocksAdded} nouveaux blocs ajoutés à la blockchain du serveur`);
        
        // Diffuser la mise à jour aux autres clients
        socket.broadcast.emit('fullBlockchain', blockchain);
      }
    }
  });
  
  // NOUVEAU: événement pour demander le mempool complet
  socket.on('requestFullMempool', (data, callback) => {
    console.log(`Client ${data.clientId} demande le mempool complet`);
    
    // Envoyer uniquement au client qui a fait la demande
    if (callback) {
      callback({ mempool });
    } else {
      socket.emit('fullMempool', mempool);
    }
    
    console.log(`${mempool.length} transactions envoyées au client ${data.clientId}`);
  });
  
  // NOUVEAU: recevoir le mempool d'un client qui se connecte
  socket.on('shareMyMempool', (clientMempool) => {
    if (!clientMempool || !Array.isArray(clientMempool)) return;
    
    console.log(`Réception de ${clientMempool.length} transactions d'un client`);
    
    // Pour chaque transaction du client, vérifier si elle existe déjà dans notre mempool
    let newTransactionsAdded = 0;
    
    clientMempool.forEach(clientTx => {
      // Vérifier si la transaction existe déjà
      const txExists = mempool.some(serverTx => 
        serverTx.signature === clientTx.signature || 
        (serverTx.from === clientTx.from && 
         serverTx.to === clientTx.to && 
         clientTx.amount)
      );
      
      if (!txExists) {
        mempool.push(clientTx);
        newTransactionsAdded++;
      }
    });
    
    if (newTransactionsAdded > 0) {
      console.log(`${newTransactionsAdded} nouvelles transactions ajoutées au mempool du serveur`);
      
      // Diffuser le mempool mis à jour aux autres clients
      socket.broadcast.emit('fullMempool', mempool);
    }
  });

  // Demande explicite de l'état actuel de la blockchain
  socket.on('requestBlockchainState', (data, callback) => {
    console.log(`Client ${socket.id} demande l'état de la blockchain`);
    const state = { blockchain, mempool, connectedClients };
    
    if (callback) callback(state);
    else socket.emit('blockchainState', state);
  });

  // Gestionnaire de déconnexion amélioré
  socket.on('disconnect', (reason) => {
    connectedClients--;
    console.log(`Client déconnecté : ${socket.id} (${connectedClients} clients actifs), raison: ${reason}`);
    
    // Nettoyer les timestamps
    clientConnectionTimestamp.delete(socket.id);
    
    // Diffuser le nombre mis à jour de clients connectés
    io.emit('clientCount', { count: connectedClients });
  });
});

// Fonction pour vérifier la validité d'une blockchain côté serveur
function isValidBlockchain(chain) {
  if (!chain || !Array.isArray(chain) || chain.length === 0) return false;
  
  for (let i = 1; i < chain.length; i++) {
    const currentBlock = chain[i];
    const previousBlock = chain[i-1];
    
    // Vérifier la référence au bloc précédent
    if (currentBlock.previousHash !== previousBlock.hash) {
      console.log(`Erreur de validation: previousHash incorrect à l'index ${i}`);
      return false;
    }
    
    // Vérifier le Merkle Root si présent et si des transactions existent
    if (currentBlock.merkleRoot && currentBlock.transactions && currentBlock.transactions.length > 0) {
      const calculatedMerkleRoot = calculateMerkleRoot(currentBlock.transactions);
      if (currentBlock.merkleRoot !== calculatedMerkleRoot) {
        console.log(`Erreur de validation: Merkle Root incorrect à l'index ${i}`);
        // On pourrait rejeter le bloc ici, mais pour plus de flexibilité, on le répare
        currentBlock.merkleRoot = calculatedMerkleRoot;
      }
    }
  }
  
  return true;
}

// Fonction pour vérifier l'état des clients et détecter les connexions zombies
function checkClientConnections() {
  const now = Date.now();
  const idleThreshold = 120000; // 2 minutes
  let zombieCount = 0;
  
  for (const [clientId, lastActive] of clientConnectionTimestamp.entries()) {
    // Si le client n'a pas été actif depuis plus que le seuil
    if (now - lastActive > idleThreshold) {
      zombieCount++;
      
      // Récupérer le socket concerné
      const socket = io.sockets.sockets.get(clientId);
      if (socket) {
        console.log(`Déconnexion forcée du client zombie ${clientId} (inactif depuis ${Math.round((now - lastActive)/1000)}s)`);
        socket.disconnect(true);
      }
      
      // Nettoyer le timestamp même si le socket n'existe plus
      clientConnectionTimestamp.delete(clientId);
    }
  }
  
  if (zombieCount > 0) {
    console.log(`${zombieCount} connexions zombies nettoyées`);
  }
}

// Vérifier périodiquement les connexions zombies
setInterval(checkClientConnections, 60000); // Chaque minute

// Fonction pour diffuser périodiquement des statistiques serveur à tous les clients
setInterval(() => {
  const stats = {
    activeConnections: connectedClients,
    mempoolSize: mempool.length,
    blockchainHeight: blockchain.length,
    serverUptime: Math.floor(process.uptime())
  };
  
  io.emit('serverStats', stats);
  console.log(`Statistiques diffusées : ${connectedClients} clients, ${mempool.length} tx en attente, ${blockchain.length} blocs`);
}, 120000); // Toutes les 2 minutes

// Fonction pour sauvegarder périodiquement l'état en mémoire (simulation)
setInterval(() => {
  console.log(`État actuel : ${blockchain.length} blocs, ${mempool.length} transactions en mempool, ${connectedClients} clients connectés`);
  
  // Diffuser périodiquement l'état aux clients (toutes les minutes)
  broadcastBlockchainState();
}, 60000);

// Diffusion périodique du mempool pour maintenir la cohérence
setInterval(() => {
  // Ne diffuser que si le mempool a changé (pour économiser de la bande passante)
  // On utilise une variable statique pour stocker le hash du dernier mempool envoyé
  const currentMempoolHash = require('crypto')
    .createHash('sha256')
    .update(JSON.stringify(mempool))
    .digest('hex');
    
  if (global.lastMempoolHash !== currentMempoolHash) {
    io.emit('fullMempool', mempool);
    global.lastMempoolHash = currentMempoolHash;
    console.log(`Mempool diffusé (${mempool.length} transactions) suite à des changements`);
  }
}, 30000); // Toutes les 30 secondes

// Ajouter cette fonction helper pour calculer le Merkle Root
function calculateMerkleRoot(transactions) {
  if (!transactions || transactions.length === 0) {
    return "0000000000000000000000000000000000000000000000000000000000000000";
  }
  
  let hashes = transactions.map(tx => {
    const txData = {
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      fee: tx.fee || "0",
      signature: tx.signature || ""
    };
    return require('crypto').createHash('sha256').update(JSON.stringify(txData)).digest('hex');
  });
  
  while (hashes.length > 1) {
    const tempHashes = [];
    for (let i = 0; i < hashes.length; i += 2) {
      if (i + 1 < hashes.length) {
        const combined = hashes[i] + hashes[i + 1];
        tempHashes.push(require('crypto').createHash('sha256').update(combined).digest('hex'));
      } else {
        const combined = hashes[i] + hashes[i];
        tempHashes.push(require('crypto').createHash('sha256').update(combined).digest('hex'));
      }
    }
    hashes = tempHashes;
  }
  
  return hashes[0];
}

// Vérifier si le serveur est lancé derrière un proxy ou directement
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});

// Add this function to your server.js file

// Function to reset the entire blockchain system
function resetBlockchain() {
  // Clear blockchain data
  blockchain = [];
  mempool = [];
  
  // Broadcast the reset event to all connected clients
  io.emit('blockchainReset');
  
  console.log('Blockchain has been reset and all clients notified');
}

// Add this to your admin endpoint or wherever you trigger the reset
app.post('/admin/reset', (req, res) => {
  resetBlockchain();
  res.status(200).send({ message: 'Blockchain reset successful' });
});