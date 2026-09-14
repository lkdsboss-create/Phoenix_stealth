const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { handleMessages, handleReceipts } = require('./core/messages');

// ==========================================
// ANTI-CRASH GLOBAL - Empêche Node de mourir sur TypeError
// ==========================================
process.on('uncaughtException', (err) => {
    console.error(`🔥 [ANTI-CRASH] uncaughtException:`, err.message);
    // Ne pas exit, on laisse le bot continuer
});
process.on('unhandledRejection', (reason) => {
    console.error(`🔥 [ANTI-CRASH] unhandledRejection:`, reason);
});

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

setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const jid in botState.statusCache) {
        botState.statusCache[jid] = botState.statusCache[jid].filter(s => (now - s.timestamp) < 86400);
        if (botState.statusCache[jid].length === 0) delete botState.statusCache[jid];
    }
    // Nettoyage cache messages pour éviter RAM leak
    if (botState.cacheMessages.size > 500) {
        const firstKey = botState.cacheMessages.keys().next().value;
        botState.cacheMessages.delete(firstKey);
    }
}, 3600000);

// ==========================================
// MOTEUR DE CONNEXION - VERSION DURCIE
// ==========================================
let reconnectTimer = null;
let pairingTimer = null;

async function startStealthBot() {
    try {
        console.log('\n📡 [SYSTEM] Initialisation du Noyau Phoenix Stealth (Modulaire)...');
        
        // IMPORTANT: Sur Render, ce dossier DOIT être sur un Disk persistant
        // Sinon à chaque redéploiement tu perds creds.json et tu dois refaire un code
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
                    console.log('⚠️ CONFLIT 440: Session ouverte ailleurs. Vérifie que tu n\'as pas 2 bots avec le même auth_info/');
                    console.log('⏳ Attente 15s avant reconnexion pour éviter boucle...');
                    if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 15000);
                } else if (shouldReconnect) {
                    console.log('🔄 Reconnexion en cours...');
                    if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 3000);
                } else {
                    console.log('❌ Session déconnectée. Nouveau code requis. Supprime auth_info et redémarre.');
                }
            } else if (connection === 'open') {
                console.log('\n==================================================');
                console.log('🦅 PHOENIX ONLINE — STEALTH v5.4.1 (Modulaire)');
                console.log('==================================================\n');
                try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
            }

            // Demande de code de jumelage uniquement si non enregistré
            if (qr === undefined && !sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                pairingTimer = setTimeout(async () => {
                    try {
                        console.log(`📱 Demande de code pour ${botState.PHONE_NUMBER}...`);
                        let code = await sock.requestPairingCode(botState.PHONE_NUMBER);
                        console.log(`🎯 TON CODE DE JUMELAGE : ${code?.match(/.{1,4}/g)?.join('-')}`);
                    } catch (err) { 
                        console.error('Erreur pairing:', err.message);
                        pairingRequested = false; 
                    }
                }, 3000);
            }
        });

        // RECEPTION DES MESSAGES - AVEC TRY/CATCH ANTI-CRASH
        sock.ev.on('messages.upsert', async (m) => {
            try {
                await handleMessages(sock, m, botState);
            } catch (e) {
                console.error('⚠️ [MESSAGES] Erreur non bloquante:', e.message);
            }
        });

        sock.ev.on('message-receipt.update', (events) => {
            try {
                handleReceipts(events, botState);
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
