const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Importation de tes modules externes
const { handleMessages, handleReceipts } = require('./core/messages');

// ==========================================
// ANTI-CRASH GLOBAL
// ==========================================
process.on('uncaughtException', (err) => {
    console.error(`🔥 [ANTI-CRASH] uncaughtException:`, err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error(`🔥 [ANTI-CRASH] unhandledRejection:`, reason);
});

// ==========================================
// SERVEUR CLOUD & BLOQUEUR DE LOGS
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Noyau Phoenix Actif.'));
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Serveur Web actif.`));

const originalLog = console.log;
console.log = (...args) => {
    if (typeof args[0] === 'string' && (args[0].includes('Closing session:') || args[0].includes('currentRatchet'))) return;
    originalLog.apply(console, args);
};

// ==========================================
// ÉTAT GLOBAL DU BOT
// ==========================================
const LOCAL_DIR = path.join(__dirname, 'Phoenix_Media');
const NAMES_FILE = path.join(LOCAL_DIR, 'contacts_names.json');

if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });

let cleanContacts = {};
if (fs.existsSync(NAMES_FILE)) {
    try {
        const rawContacts = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf-8'));
        let hasAliases = false;
        for (const [key, name] of Object.entries(rawContacts)) {
            const cleanKey = jidNormalizedUser(key);
            cleanContacts[cleanKey] = name;
            if (cleanKey !== key) hasAliases = true;
        }
        if (hasAliases) {
            fs.writeFileSync(NAMES_FILE, JSON.stringify(cleanContacts, null, 2));
            console.log("🧹 Base de données des contacts nettoyée des alias.");
        }
    } catch (e) {}
}

const botState = {
    // N'oublie pas de mettre ton numéro ici si tu ne passes pas par les variables d'environnement
    PHONE_NUMBER: process.env.PHONE_NUMBER || "22896081989", 
    START_TIME: Date.now(),
    LOCAL_DIR: LOCAL_DIR,
    NAMES_FILE: NAMES_FILE,
    cacheMessages: new Map(),
    contactNames: cleanContacts,
    activeIntervals: {},
    statusCache: {},
    isSavingContacts: false,
    currentSock: null
};

// Nettoyage périodique de la RAM
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const jid in botState.statusCache) {
        botState.statusCache[jid] = botState.statusCache[jid].filter(s => (now - s.timestamp) < 86400);
        if (botState.statusCache[jid].length === 0) delete botState.statusCache[jid];
    }
    if (botState.cacheMessages.size > 500) {
        const firstKey = botState.cacheMessages.keys().next().value;
        botState.cacheMessages.delete(firstKey);
    }
}, 3600000);

// ==========================================
// MOTEUR DE CONNEXION
// ==========================================
let reconnectTimer = null;
let pairingTimer = null;

async function startStealthBot() {
    try {
        console.log('\n📡 [SYSTEM] Initialisation du Noyau Phoenix Stealth (Modulaire)...');
        
        const AUTH_DIR = process.env.AUTH_DIR || './auth_info';
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        const sock = makeWASocket({
            logger: pino({ level: 'silent' }), 
            auth: state,
            markOnlineOnConnect: false, 
            syncFullHistory: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            getMessage: async (key) => botState.cacheMessages.get(key.id)?.message || undefined
        });

        botState.currentSock = sock;
        sock.ev.on('creds.update', saveCreds);

        let pairingRequested = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (connection === 'close') {
                if (pairingTimer) clearTimeout(pairingTimer);
                for (const jid in botState.activeIntervals) clearInterval(botState.activeIntervals[jid]);
                botState.activeIntervals = {};
                if (botState.currentSock === sock) botState.currentSock = null;

                pairingRequested = false; 
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`🔌 Connexion fermée. Code: ${statusCode} - ${lastDisconnect?.error?.message}`);

                if (statusCode === 440) {
                    console.log('⚠️ CONFLIT 440: Session ouverte ailleurs.');
                    if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 15000);
                } else if (shouldReconnect) {
                    console.log('🔄 Reconnexion en cours dans 3 secondes...');
                    if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 3000);
                } else {
                    console.log('❌ Session déconnectée. Nouveau code requis.');
                }
            } else if (connection === 'open') {
                console.log('\n==================================================');
                console.log('🦅 PHOENIX ONLINE — STEALTH (Modulaire)');
                console.log('==================================================\n');
                try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
            }

            // CORRECTION : On demande le code uniquement si la socket est en phase de connexion/enregistrement
            // et que le client n'est pas déjà enregistré.
            if (!sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                // On s'assure d'attendre un court instant que la liaison WS soit stable
                pairingTimer = setTimeout(async () => {
                    try {
                        console.log(`📱 Demande de code de pairage pour ${botState.PHONE_NUMBER}...`);
                        let code = await sock.requestPairingCode(botState.PHONE_NUMBER);
                        console.log(`\n======================================================`);
                        console.log(`🎯 TON CODE DE JUMELAGE : ${code?.match(/.{1,4}/g)?.join('-')}`);
                        console.log(`======================================================\n`);
                    } catch (err) { 
                        console.error('Erreur pairing:', err.message);
                        pairingRequested = false; 
                    }
                }, 5000); // Délai allongé à 5 secondes pour éviter le "Connection Closed"
            }
        });


        // Routage des événements vers les fichiers modulaires
        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (m.type !== 'notify') return;
                await handleMessages(sock, m, botState);
            } catch (e) {
                console.error('⚠️ [MESSAGES] Erreur non bloquante:', e.message);
            }
        });

        sock.ev.on('message-receipt.update', (events) => {
            try {
                if (handleReceipts) handleReceipts(events, botState);
            } catch (e) {
                console.error('⚠️ [RECEIPTS] Erreur non bloquante:', e.message);
            }
        });

    } catch (err) {
        console.error('🔥 Erreur startStealthBot:', err);
        if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 5000);
    }
}

startStealthBot();
