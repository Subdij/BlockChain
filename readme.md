# SUBCHAINE - Simulateur de Blockchain

## 📖 Description
**SUBCHAINE** est un simulateur de blockchain. Cette application web permet de découvrir les concepts fondamentaux de la blockchain avec des fonctionnalités clés : création de wallets, minage de blocs, transactions sécurisées et visualisation de la blockchain.

---

## ⚙️ Prérequis
Avant de commencer, assurez-vous d'avoir installé :
- **Node.js** (version 14.0 ou supérieure)
- **NPM** (inclus avec Node.js)
- Un navigateur web moderne avec support JavaScript

---

## 🚀 Installation
1. **Clonez le dépôt** :
    ```bash
    git clone https://github.com/Subdij/BlockChain.git
    ```

2. **Installez les dépendances** :
    ```bash
    cd BlockChain
    npm install
    ```

3. **Dépendances frontend** : Incluses via CDN :
   - `crypto-js` : Fonctions de hachage
   - `elliptic` : Cryptographie à courbe elliptique

---

## ▶️ Lancement de l'application
1. **Démarrez le serveur Node.js** :
    ```bash
    node server.js
    ```

2. **Accédez à l'application** :
    [http://localhost:3000](http://localhost:3000)

---

## 📂 Structure du projet
- **`/public`** : Contient les fichiers frontend (HTML, CSS, JS)
  - `block.html` : Interface de minage
  - `wallet.html` : Gestion des wallets
  - `transaction.html` : Création de transactions
  - `blockchain-visualizer.html` : Visualisation de la blockchain
  - `cryptage.html` : Démonstration de cryptographie
  - `SHA-256.html` : Démonstration de hachage
- **`server.js`** : Serveur backend (Node.js/Express)
- **`package.json`** : Configuration du projet et dépendances

---

## ✨ Fonctionnalités principales
- **Gestion de wallets** : Création et gestion de paires de clés cryptographiques
- **Transactions sécurisées** : Signatures cryptographiques
- **Minage de blocs** : Proof of Work avec récompenses
- **Visualisation graphique** : Structure de la blockchain
- **Communication en temps réel** : Entre utilisateurs
- **Démonstrations pédagogiques** : Mécanismes cryptographiques

---

## 🛠️ Technologies utilisées
- **Backend** : Node.js, Express
- **Frontend** : HTML, CSS, JavaScript vanilla
- **Temps réel** : Socket.io
- **Cryptographie** : crypto-js, elliptic (secp256k1)

---

## 📝 Guide d'utilisation
1. **Création de wallet** : Accédez à la page "Wallet" pour créer un wallet avec un pseudonyme.
2. **Transactions** : Utilisez la page "Transaction" pour envoyer des fonds entre wallets.
3. **Minage** : Sur la page "Mining", sélectionnez votre wallet et commencez le minage.
4. **Visualisation** : Explorez la structure de la blockchain sur la page "Visualiser".