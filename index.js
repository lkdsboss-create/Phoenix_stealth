const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const qrcode = require('qrcode-terminal');
const readline = require('readline');

const { handleMessages, handleReceipts } = require('./core/messages');
const { handleDeliveryReceipt } = require('./core/silentTracker');

// ==========================================
// ANTI-CRASH
// ==========================================
process.on('uncaughtException', (err) => {
    console.error(`🔥 [ANTI-CRASH] uncaughtException:`, err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error(`🔥 [ANTI-CRASH] unhandledRejection:`, reason);
});

// ==========================================
// SERVEUR
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Noyau Phoenix Actif.'));
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Serveur Web actif.`));

// ==========================================
// FILTRE DE LOGS
// ==========================================
const FILTERED = [
    'Closing session:', 'Closing open session', 'currentRatchet',
    'SessionEntry', '_chains:', 'ephemeralKeyPair:',
    'lastRemoteEphemeralKey:', 'previousCounter:', 'rootKey:',
    'indexInfo:', 'baseKey:', 'baseKeyType:', 'remoteIdentityKey:',
    'pendingPreKey:', 'registrationId:', 'chainKey:', 'chainType:',
    'messageKeys:', 'signedKeyId:', 'preKeyId:'
];

const originalLog = console.log;
console.log = (...args) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (FILTERED.some(f => first.includes(f))) return;
    originalLog.apply(console, args);
};

const originalError = console.error;
console.error = (...args) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (FILTERED.some(f => first.includes(f))) return;
    originalError.apply(console, args);
};

// ==========================================
// ÉTAT GLOBAL
// ==========================================
const LOCAL_DIR = path.join(__dirname, 'Phoenix_Media');
const NAMES_FILE = path.join(LOCAL_DIR, 'contacts_names.json');
const STATUS_JSON = path.join(LOCAL_DIR, 'status_cache.json');
const STATUS_DIR = path.join(LOCAL_DIR, 'statuses');

if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
if (!fs.existsSync(STATUS_DIR)) fs.mkdirSync(STATUS_DIR, { recursive: true });

let cleanContacts = {};
if (fs.existsSync(NAMES_FILE)) {
    try {
        const rawContacts = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf-8'));
        for (const [key, name] of Object.entries(rawContacts)) {
            cleanContacts[jidNormalizedUser(key)] = name;
        }
    } catch (e) { }
}

const botState = {
    PHONE_NUMBER: process.env.PHONE_NUMBER || "22896081989",
    START_TIME: Date.now(),
    LOCAL_DIR: LOCAL_DIR,
    NAMES_FILE: NAMES_FILE,
    STATUS_JSON: STATUS_JSON,
    DIRS: { statuts: STATUS_DIR },
    cacheMessages: new Map(),
    contactNames: cleanContacts,
    activeIntervals: {},
    statusCache: {},
    isSavingContacts: false,
    isSavingStatus: false,
    currentSock: null,
    onlineUsers: new Map(),
    subscribedJids: new Set(),
    loginMode: null // 'qr' ou 'pairing'
};

global.botState = botState;
if (!globalThis.lidPhoneCache) globalThis.lidPhoneCache = new Map();

// ==========================================
// SAUVEGARDE CONTACTS
// ==========================================
let saveContactsTimer = null;
function scheduleSaveContacts() {
    if (saveContactsTimer) clearTimeout(saveContactsTimer);
    saveContactsTimer = setTimeout(() => {
        try {
            fs.writeFileSync(botState.NAMES_FILE, JSON.stringify(botState.contactNames, null, 2));
        } catch (e) { }
    }, 3000);
}

// ==========================================
// NETTOYAGE PÉRIODIQUE
// ==========================================
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const jid in botState.statusCache) {
        botState.statusCache[jid] = botState.statusCache[jid].filter(s => (now - s.timestamp) < 86400);
        if (botState.statusCache[jid].length === 0) delete botState.statusCache[jid];
    }
    if (botState.cacheMessages.size > 3000) {
        const firstKey = botState.cacheMessages.keys().next().value;
        botState.cacheMessages.delete(firstKey);
    }
    const nowMs = Date.now();
    for (const [jid, ts] of botState.onlineUsers.entries()) {
        if (nowMs - ts > 120000) botState.onlineUsers.delete(jid);
    }
}, 3600000);

// ==========================================
// VERSION STATIQUE
// ==========================================
const WHATSAPP_VERSION = [2, 3000, 1043857760];

// ==========================================
// CHOIX DU MODE DE CONNEXION
// ==========================================
function askLoginMode() {
    return new Promise((resolve) => {
        // Vérifie si une session existe déjà
        const AUTH_DIR = process.env.AUTH_DIR || './auth_info';
        const credsExist = fs.existsSync(path.join(AUTH_DIR, 'creds.json'));

        if (credsExist) {
            console.log('\n🔐 Session existante détectée → connexion automatique...\n');
            resolve('existing');
            return;
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\n╔════════════════════════════════════════════════════╗');
        console.log('║  🦅 PHOENIX STEALTH — MODE DE CONNEXION            ║');
        console.log('╠════════════════════════════════════════════════════╣');
        console.log('║                                                    ║');
        console.log('║   1 → 📱 QR Code                                   ║');
        console.log('║       (scanner avec un 2ème appareil)              ║');
        console.log('║                                                    ║');
        console.log('║   2 → 🔢 Pairing Code                              ║');
        console.log('║       (taper un code sur WhatsApp)                 ║');
        console.log('║                                                    ║');
        console.log('╚════════════════════════════════════════════════════╝\n');

        rl.question('👉 Ton choix (1 ou 2) : ', (answer) => {
            rl.close();
            const choice = answer.trim();
            if (choice === '2') {
                console.log('\n✅ Mode sélectionné : 🔢 Pairing Code\n');
                resolve('pairing');
            } else if (choice === '1') {
                console.log('\n✅ Mode sélectionné : 📱 QR Code\n');
                resolve('qr');
            } else {
                console.log('\n⚠️ Choix invalide → QR Code par défaut\n');
                resolve('qr');
            }
        });
    });
}

// ==========================================
// MOTEUR
// ==========================================
let reconnectTimer = null;
let attemptCount = 0;
const MAX_ATTEMPTS = 3;

async function startStealthBot() {
    try {
        attemptCount++;
        console.log(`\n📡 [SYSTEM] Initialisation du Noyau Phoenix Stealth (Tentative #${attemptCount})...`);

        const AUTH_DIR = process.env.AUTH_DIR || './auth_info';
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        const sock = makeWASocket({
            version: WHATSAPP_VERSION,
            logger: pino({ level: 'silent' }),
            auth: state,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            browser: ['Chrome (Linux)', '', ''],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            getMessage: async (key) => botState.cacheMessages.get(key.id)?.message || undefined
        });

        botState.currentSock = sock;
        sock.ev.on('creds.update', saveCreds);

        // ==========================================
        // MODE DE CONNEXION
        // ==========================================
        let pairingRequested = false;
        let pairingTimer = null;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // ==========================================
            // AFFICHAGE QR (uniquement si mode 'qr')
            // ==========================================
            if (qr && botState.loginMode === 'qr') {
                console.clear();
                console.log('\n======================================================');
                console.log('📱 SCANNE CE QR CODE avec WhatsApp');
                console.log('   (WhatsApp → Appareils connectés → Associer un appareil)');
                console.log('======================================================\n');
                qrcode.generate(qr, { small: true });
                console.log('\n⏳ Le QR expire dans ~20 secondes. Un nouveau sera généré automatiquement.\n');
            }

            // ==========================================
            // PAIRE CODE (uniquement si mode 'pairing')
            // ==========================================
            if (qr && botState.loginMode === 'pairing' && !sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                console.log('\n🔢 Mode pairing code — envoi de la demande...');

                if (pairingTimer) clearTimeout(pairingTimer);
                pairingTimer = setTimeout(async () => {
                    try {
                        console.log(`📞 Demande de code pour ${botState.PHONE_NUMBER}...`);
                        const code = await sock.requestPairingCode(botState.PHONE_NUMBER);

                        console.log('\n======================================================');
                        console.log(`🎯 TON CODE DE JUMELAGE : ${code?.match(/.{1,4}/g)?.join('-')}`);
                        console.log('======================================================');
                        console.log('📖 Comment faire :');
                        console.log('   1. Ouvre WhatsApp');
                        console.log('   2. Paramètres → Appareils connectés');
                        console.log('   3. Associer un appareil');
                        console.log('   4. Choisis "Associer avec un numéro de téléphone"');
                        console.log('   5. Tape le code ci-dessus');
                        console.log('======================================================\n');
                    } catch (err) {
                        console.error('❌ Erreur pairing:', err.message);
                        pairingRequested = false;
                    }
                }, 5000);
            }

            // ==========================================
            // CONNEXION FERMÉE
            // ==========================================
            if (connection === 'close') {
                if (pairingTimer) clearTimeout(pairingTimer);
                for (const jid in botState.activeIntervals) clearInterval(botState.activeIntervals[jid]);
                botState.activeIntervals = {};
                if (botState.currentSock === sock) botState.currentSock = null;

                pairingRequested = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`🔌 Connexion fermée. Code: ${statusCode}`);

                if (statusCode === 401 || statusCode === 408 || statusCode === 428) {
                    console.log('🧹 Nettoyage session corrompue...');
                    try {
                        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    } catch (e) { }
                    // Redemande le mode au prochain démarrage
                    botState.loginMode = null;
                }

                let delay = 3000;
                if (statusCode === 440) delay = 15000;
                if (statusCode === 405 && attemptCount >= MAX_ATTEMPTS) {
                    delay = 30000;
                    attemptCount = 0;
                }

                if (shouldReconnect && !reconnectTimer) {
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        // Si la session a été supprimée, on redemande le mode
                        if (!botState.loginMode) {
                            askLoginMode().then((mode) => {
                                botState.loginMode = mode === 'existing' ? 'qr' : mode;
                                startStealthBot();
                            });
                        } else {
                            startStealthBot();
                        }
                    }, delay);
                }
            } else if (connection === 'open') {
                attemptCount = 0;
                console.log('\n==================================================');
                console.log('🦅 PHOENIX ONLINE');
                console.log('==================================================\n');
                try { await sock.sendPresenceUpdate('unavailable'); } catch (e) { }
            }
        });

        // ==========================================
        // LID MAPPING
        // ==========================================
        sock.ev.on('lid-mapping.update', (map) => {
            try {
                let updated = 0;
                for (const [lid, pn] of Object.entries(map || {})) {
                    const lidNum = String(lid).split('@')[0].split(':')[0];
                    const phone = String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
                    if (lidNum && phone) {
                        globalThis.lidPhoneCache.set(lidNum, phone);
                        updated++;
                    }
                }
                if (updated > 0) console.log(`📇 [LID] +${updated} (total : ${globalThis.lidPhoneCache.size})`);
            } catch (e) { }
        });

        // ==========================================
        // CONTACTS
        // ==========================================
        sock.ev.on('contacts.upsert', async (contacts) => {
            let newNames = 0;
            for (const contact of contacts || []) {
                if (contact.id && contact.notify && contact.notify.trim().length > 1) {
                    if (!botState.contactNames[contact.id]) {
                        botState.contactNames[contact.id] = contact.notify;
                        newNames++;
                    }
                }
                if (contact.id && !botState.subscribedJids.has(contact.id)) {
                    try {
                        await sock.presenceSubscribe(contact.id);
                        botState.subscribedJids.add(contact.id);
                    } catch (e) { }
                }
            }
            if (newNames > 0) {
                console.log(`📇 [CONTACTS] +${newNames} nom(s) mémorisé(s)`);
                scheduleSaveContacts();
            }
        });

        // ==========================================
        // ABONNEMENT PRÉSENCES
        // ==========================================
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                const jid = msg.key?.remoteJid;
                const participant = msg.key?.participant || jid;

                if (!msg.key.fromMe && msg.pushName && participant) {
                    if (!botState.contactNames[participant]) {
                        botState.contactNames[participant] = msg.pushName;
                        scheduleSaveContacts();
                    }
                }

                if (jid && !jid.endsWith('@g.us') && jid !== 'status@broadcast' && !botState.subscribedJids.has(jid)) {
                    try {
                        await sock.presenceSubscribe(jid);
                        botState.subscribedJids.add(jid);
                    } catch (e) { }
                }
            }
        });

        // ==========================================
        // PRÉSENCES
        // ==========================================
        sock.ev.on('presence.update', ({ id, presences }) => {
            for (const jid in (presences || {})) {
                const status = presences[jid].lastKnownPresence;
                if (status === 'available' || status === 'composing' || status === 'recording') {
                    const wasOffline = !botState.onlineUsers.has(jid);
                    botState.onlineUsers.set(jid, Date.now());
                    if (wasOffline) {
                        const name = botState.contactNames[jid] || jid.split('@')[0];
                        console.log(`🟢 ${name} est en ligne`);
                    }
                } else if (status === 'unavailable') {
                    botState.onlineUsers.delete(jid);
                }
            }
        });

        // ==========================================
        // MESSAGES
        // ==========================================
        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (m.type !== 'notify') return;
                await handleMessages(sock, m, botState);
            } catch (e) {
                console.error('⚠️ [MESSAGES] Erreur:', e.message);
            }
        });

        // ==========================================
        // ACCUSÉS DE RÉCEPTION
        // ==========================================
        sock.ev.on('message-receipt.update', (events) => {
            try {
                handleDeliveryReceipt(events);
                if (handleReceipts) handleReceipts(events, botState);
            } catch (e) { }
        });

    } catch (err) {
        console.error('🔥 Erreur startStealthBot:', err);
        if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 5000);
    }
}

// ==========================================
// DÉMARRAGE
// ==========================================
async function main() {
    botState.loginMode = await askLoginMode();
    if (botState.loginMode === 'existing') botState.loginMode = 'qr';
    startStealthBot();
}

main();
