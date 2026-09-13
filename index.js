const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { handleMessages, handleReceipts } = require('./core/messages');

// ==========================================
// SERVEUR RENDER & BLOQUEUR DE LOGS
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
// ÉTAT GLOBAL DU BOT (Mémoire partagée)
// ==========================================
const LOCAL_DIR = path.join(__dirname, 'Phoenix_Media');
const NAMES_FILE = path.join(LOCAL_DIR, 'contacts_names.json');

if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });

// 🛡️ VACCIN ANTI-ALIAS : Nettoyage automatique des anciens contacts corrompus
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
        
        // S'il a trouvé et réparé des alias, il réécrit le fichier proprement
        if (hasAliases) {
            fs.writeFileSync(NAMES_FILE, JSON.stringify(cleanContacts, null, 2));
            console.log("🧹 Base de données des contacts nettoyée des alias.");
        }
    } catch (e) {}
}

const botState = {
    PHONE_NUMBER: "22896081989",
    START_TIME: Date.now(),
    LOCAL_DIR: LOCAL_DIR,
    NAMES_FILE: NAMES_FILE,
    cacheMessages: new Map(),
    contactNames: cleanContacts, // On charge la base de données 100% propre
    activeIntervals: {},
    statusCache: {},
    isSavingContacts: false,
    currentSock: null
};

// Nettoyage RAM des statuts (Toutes les heures)
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const jid in botState.statusCache) {
        botState.statusCache[jid] = botState.statusCache[jid].filter(s => (now - s.timestamp) < 86400);
        if (botState.statusCache[jid].length === 0) delete botState.statusCache[jid];
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
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

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
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    console.log('🔄 Reconnexion en cours...');
                    if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 3000);
                } else {
                    console.log('❌ Session déconnectée. Nouveau code requis.');
                }
            } else if (connection === 'open') {
                console.log('\n==================================================');
                console.log('🦅 PHOENIX ONLINE — STEALTH v5.4.1 (Modulaire)');
                console.log('==================================================\n');
                try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
            }

            if (qr === undefined && !sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                pairingTimer = setTimeout(async () => {
                    try {
                        let code = await sock.requestPairingCode(botState.PHONE_NUMBER);
                        console.log(`🎯 TON CODE DE JUMELAGE : ${code?.match(/.{1,4}/g)?.join('-')}`);
                    } catch (err) { pairingRequested = false; }
                }, 3000);
            }
        });

        // RECEPTION DES MESSAGES
        sock.ev.on('messages.upsert', async (m) => {
            await handleMessages(sock, m, botState);
        });

        // SYNCHRONISATION DES LECTURES (TELEPHONE -> BOT)
        sock.ev.on('message-receipt.update', (events) => {
            handleReceipts(events, botState);
        });

    } catch (err) {
        if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 5000);
    }
}

startStealthBot();
