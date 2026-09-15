const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

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
    PHONE_NUMBER: process.env.PHONE_NUMBER || "22896081989",
    START_TIME: Date.now(),
    LOCAL_DIR: LOCAL_DIR,
    NAMES_FILE: NAMES_FILE,
    cacheMessages: new Map(),
    contactNames: cleanContacts,
    activeIntervals: {},
    statusCache: {},
    isSavingContacts: false,
    currentSock: null,
    recentMedia: new Map()
};

// Rendre botState accessible globalement
global.botState = botState;

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

    // Nettoyage des médias récents (60 secondes)
    const cutoff = Date.now() - 60 * 1000;
    if (botState.recentMedia) {
        for (const [sender, list] of botState.recentMedia.entries()) {
            const filtered = list.filter(m => m.timestamp > cutoff);
            if (filtered.length === 0) botState.recentMedia.delete(sender);
            else botState.recentMedia.set(sender, filtered);
        }
    }
}, 30000);

// ==========================================
// MOTEUR DE CONNEXION (MODE QR)
// ==========================================
let reconnectTimer = null;

async function startStealthBot() {
    try {
        console.log('\n📡 [SYSTEM] Initialisation du Noyau Phoenix Stealth (Mode QR)...');

        const AUTH_DIR = process.env.AUTH_DIR || './auth_info';
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        const { version } = await fetchLatestBaileysVersion();
        console.log(`📦 Version API WhatsApp : ${version.join('.')}`);

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            auth: state,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            browser: ['Chrome (Linux)', '', ''],
            getMessage: async (key) => botState.cacheMessages.get(key.id)?.message || undefined
        });

        botState.currentSock = sock;
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.clear();
                console.log('\n======================================================');
                console.log('📱 SCANNE CE QR CODE avec WhatsApp');
                console.log('   (WhatsApp → Appareils connectés → Associer un appareil)');
                console.log('======================================================\n');

                qrcode.generate(qr, { small: true });

                console.log('\n⏳ Le QR expire dans ~20 secondes. Un nouveau sera généré automatiquement.\n');
            }

            if (connection === 'close') {
                for (const jid in botState.activeIntervals) clearInterval(botState.activeIntervals[jid]);
                botState.activeIntervals = {};
                if (botState.currentSock === sock) botState.currentSock = null;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`🔌 Connexion fermée. Code: ${statusCode}`);

                const credsExist = fs.existsSync(path.join(AUTH_DIR, 'creds.json'));

                if (statusCode === 401 && !shouldReconnect) {
                    console.log('🧹 Session expirée (loggedOut confirmé). Nettoyage...');
                    try {
                        if (fs.existsSync(AUTH_DIR)) {
                            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                            console.log('✅ Dossier auth_info supprimé.');
                        }
                    } catch (e) {
                        console.error('Erreur nettoyage:', e.message);
                    }
                }

                let delay = 3000;
                let shouldRestart = true;

                if (statusCode === 515) {
                    console.log('🔄 Restart required (515) — reconnexion dans 2s...');
                    delay = 2000;
                } else if (statusCode === 440) {
                    console.log('⚠️ Session ouverte ailleurs (440). Attente 15s...');
                    delay = 15000;
                } else if (statusCode === 408) {
                    console.log('⏱️ QR expiré (408). Nouveau QR dans 3s...');
                    delay = 3000;
                } else if (statusCode === 401 && !shouldReconnect) {
                    console.log('❌ Session perdue. Nouveau QR requis.');
                    delay = 3000;
                } else if (!shouldReconnect) {
                    console.log('❌ Déconnecté par l\'utilisateur. Arrêt.');
                    shouldRestart = false;
                } else if (credsExist) {
                    console.log('🔄 Reconnexion avec session existante dans 3s...');
                    delay = 3000;
                } else {
                    console.log('🔄 Reconnexion dans 3s...');
                    delay = 3000;
                }

                if (shouldRestart && !reconnectTimer) {
                    console.log(`⏱️ Prochaine tentative dans ${Math.round(delay / 1000)}s...`);
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        startStealthBot();
                    }, delay);
                }

            } else if (connection === 'open') {
                console.log('\n==================================================');
                console.log('🦅 PHOENIX ONLINE — QR CODE VALIDÉ !');
                console.log('==================================================\n');
                try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
            }
        });

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
