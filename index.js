const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const messageHandler = require('./core/messages');
const express = require('express');

// 1. Maintien en vie du conteneur (indispensable sur le cloud)
const app = express();
app.get('/', (req, res) => res.send('Bot Phoenix_stealth en ligne'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Serveur web actif sur le port ${port}`));

// 2. Configuration du numéro de téléphone
// Remplace par le numéro de ton bot avec l'indicatif du pays, MAIS SANS le '+' ni les espaces
// Exemple pour un numéro français : "33612345678"
const phoneNumber = "TON_NUMERO_ICI"; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        // Obligatoire pour le code de pairage avec Baileys : simuler un navigateur spécifique
        browser: ['Ubuntu', 'Chrome', '20.0.04'] 
    });

    // 3. Demande du Pairing Code si aucune session n'est enregistrée
    if (!sock.authState.creds.registered) {
        // On attend 3 secondes pour s'assurer que la connexion aux serveurs WA est initialisée
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                // Ajout d'un tiret pour faciliter la lecture (ex: 1234-5678)
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n======================================================`);
                console.log(`VOTRE CODE DE PAIRAGE WHATSAPP : ${code}`);
                console.log(`======================================================\n`);
            } catch (error) {
                console.error('Erreur lors de la récupération du code de pairage :', error);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connexion fermée. Reconnexion automatique :', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('Connecté à WhatsApp avec succès !');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        await messageHandler(sock, msg);
    });
}

startBot();
