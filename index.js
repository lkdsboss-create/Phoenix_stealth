const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('toxic-baileys');
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
// 🚫 FILTRE DE LOGS AU PLUS BAS NIVEAU
// (intercepte libsignal, Baileys, etc.)
// ==========================================
const FILTER_PATTERNS = [
    'Closing session:',
    'Closing open session',
    'currentRatchet',
    'SessionEntry',
    '_chains:',
    'ephemeralKeyPair:',
    'lastRemoteEphemeralKey:',
    'previousCounter:',
    'rootKey:',
    'indexInfo:',
    'baseKey:',
    'baseKeyType:',
    'remoteIdentityKey:',
    'pendingPreKey:',
    'registrationId:',
    'chainKey:',
    'chainType:',
    'messageKeys:',
    'signedKeyId:',
    'preKeyId:',
    'pubKey:',
    'privKey:'
];

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

function shouldFilter(chunk) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    return FILTER_PATTERNS.some(p => str.includes(p));
}

process.stdout.write = (chunk, ...args) => {
    if (shouldFilter(chunk)) return true;
    return originalStdoutWrite(chunk, ...args);
};

process.stderr.write = (chunk, ...args) => {
    if (shouldFilter(chunk)) return true;
    return originalStderrWrite(chunk, ...args);
};

// ==========================================
// SERVEUR
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Noyau Phoenix Actif.'));
app.listen(process.env.PORT || 3000, () => console.log(`🌐 Serveur Web actif.`));

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
        console.log(`📇 ${Object.keys(cleanContacts).length} contact(s) chargé(s)`);
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
    loginMode: null
};

global.botState = botState;
if (!globalThis.lidPhoneCache) globalThis.lidPhoneCache = new Map();

// ==========================================
// FLAGS PERSISTANTS
// ==========================================
let PROCESS_PAIRING_REQUESTED = false;
let PROCESS_LAST_QR = '';
let PROCESS_HAS_CONNECTED = false;

function saveContactsNow() {
    try {
        fs.writeFileSync(botState.NAMES_FILE, JSON.stringify(botState.contactNames, null, 2));
    } catch (e) { }
}

let saveContactsTimer = null;
function scheduleSaveContacts() {
    if (saveContactsTimer) clearTimeout(saveContactsTimer);
    saveContactsTimer = setTimeout(saveContactsNow, 3000);
}

// ==========================================
// 🚦 QUEUE DE SUBSCRIPTION (rate-limit safe)
// ==========================================
const subscriptionQueue = [];
let isProcessingQueue = false;
let lastSubscribeTime = 0;
const MIN_SUBSCRIBE_INTERVAL = 200; // 200ms entre chaque subscribe

function enqueueSubscribe(sock, jid) {
    if (!jid) return;
    if (botState.subscribedJids.has(jid)) return;
    if (subscriptionQueue.includes(jid)) return;

    subscriptionQueue.push(jid);
    botState.subscribedJids.add(jid); // marqué immédiatement pour éviter les doublons

    if (!isProcessingQueue) processSubscriptionQueue(sock);
}

async function processSubscriptionQueue(sock) {
    isProcessingQueue = true;

    while (subscriptionQueue.length > 0) {
        const jid = subscriptionQueue.shift();
        const now = Date.now();
        const wait = MIN_SUBSCRIBE_INTERVAL - (now - lastSubscribeTime);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));

        try {
            await sock.presenceSubscribe(jid);
            lastSubscribeTime = Date.now();
        } catch (e) { }
    }

    isProcessingQueue = false;
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

const WHATSAPP_VERSION = [2, 3000, 1043857760];

// ==========================================
// CHOIX MODE
// ==========================================
function askLoginMode() {
    return new Promise((resolve) => {
        const AUTH_DIR = process.env.AUTH_DIR || './auth_info';
        const credsExist = fs.existsSync(path.join(AUTH_DIR, 'creds.json'));

        if (credsExist) {
            console.log('\n🔐 Session existante → connexion automatique...\n');
            resolve('existing');
            return;
        }

        const isTTY = process.stdin.isTTY && process.stdout.isTTY;
        if (!isTTY) {
            console.log('\n⚠️ Pas de TTY → 📱 QR par défaut\n');
            resolve('qr');
            return;
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('\n╔════════════════════════════════════════════════════╗');
        console.log('║  🦅 PHOENIX STEALTH — MODE DE CONNEXION            ║');
        console.log('║   1 → 📱 QR Code                                   ║');
        console.log('║   2 → 🔢 Pairing Code                              ║');
        console.log('╚════════════════════════════════════════════════════╝');
        console.log('⏱️  15 secondes pour choisir\n');

        let answered = false;
        const timeoutId = setTimeout(() => {
            if (answered) return;
            answered = true;
            try { rl.close(); } catch (e) { }
            console.log('\n⏱️ Timeout → 📱 QR par défaut\n');
            resolve('qr');
        }, 15000);

        rl.question('👉 Ton choix (1 ou 2) : ', (answer) => {
            if (answered) return;
            answered = true;
            clearTimeout(timeoutId);
            rl.close();
            const choice = answer.trim();
            console.log(choice === '2' ? '\n✅ Mode : 🔢 Pairing Code\n' : '\n✅ Mode : 📱 QR Code\n');
            resolve(choice === '2' ? 'pairing' : 'qr');
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
            syncFullHistory: true,
            browser: ['Chrome (Linux)', '', ''],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            getMessage: async (key) => botState.cacheMessages.get(key.id)?.message || undefined
        });

        botState.currentSock = sock;
        sock.ev.on('creds.update', saveCreds);

        let pairingTimer = null;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // QR (une seule fois par QR unique, et pas après connexion)
            if (qr && botState.loginMode === 'qr' && !PROCESS_HAS_CONNECTED) {
                if (qr !== PROCESS_LAST_QR) {
                    PROCESS_LAST_QR = qr;
                    console.clear();
                    console.log('\n======================================================');
                    console.log('📱 SCANNE CE QR CODE avec WhatsApp');
                    console.log('======================================================\n');
                    qrcode.generate(qr, { small: true });
                    console.log('\n⏳ Le QR expire dans ~20 secondes.\n');
                }
            }

            // Pairing code (une seule fois par processus)
            if (qr && botState.loginMode === 'pairing'
                && !sock.authState.creds.registered
                && !PROCESS_PAIRING_REQUESTED
                && !PROCESS_HAS_CONNECTED) {

                PROCESS_PAIRING_REQUESTED = true;
                console.log('\n🔢 Mode pairing — demande du code...');

                if (pairingTimer) clearTimeout(pairingTimer);
                pairingTimer = setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(botState.PHONE_NUMBER);
                        console.log('\n======================================================');
                        console.log(`🎯 CODE DE JUMELAGE : ${code?.match(/.{1,4}/g)?.join('-')}`);
                        console.log('======================================================');
                        console.log('📖 Paramètres → Appareils connectés → Associer');
                        console.log('   → "Avec un numéro de téléphone" → Tape le code');
                        console.log('======================================================\n');
                    } catch (err) {
                        console.error('❌ Erreur pairing:', err.message);
                    }
                }, 5000);
            }

            if (connection === 'close') {
                if (pairingTimer) clearTimeout(pairingTimer);
                for (const jid in botState.activeIntervals) clearInterval(botState.activeIntervals[jid]);
                botState.activeIntervals = {};
                if (botState.currentSock === sock) botState.currentSock = null;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`🔌 Connexion fermée. Code: ${statusCode}`);

                if (statusCode === 401 || statusCode === 408 || statusCode === 428) {
                    try {
                        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    } catch (e) { }
                    PROCESS_PAIRING_REQUESTED = false;
                    PROCESS_LAST_QR = '';
                    PROCESS_HAS_CONNECTED = false;
                    botState.loginMode = null;
                }

                let delay = 3000;
                if (statusCode === 440) delay = 15000;
                if (statusCode === 405 && attemptCount >= MAX_ATTEMPTS) {
                    delay = 30000;
                    attemptCount = 0;
                }
                if (statusCode === 503) delay = 5000;

                if (shouldReconnect && !reconnectTimer) {
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
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
                PROCESS_HAS_CONNECTED = true;
                PROCESS_PAIRING_REQUESTED = true;
                attemptCount = 0;
                console.log('\n==================================================');
                console.log('🦅 PHOENIX ONLINE');
                console.log('==================================================\n');
                try { await sock.sendPresenceUpdate('unavailable'); } catch (e) { }
            }
        });

        // 📚 HISTORIQUE (capture les contacts SANS subscribe en masse)
        sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
            try {
                let added = 0;
                for (const contact of contacts || []) {
                    if (contact.id && contact.notify && contact.notify.trim().length > 1) {
                        if (!botState.contactNames[contact.id]) {
                            botState.contactNames[contact.id] = contact.notify;
                            added++;
                        }
                    }
                    // ⚠️ PAS de presenceSubscribe ici → trop de requêtes d'un coup
                }
                if (added > 0) {
                    saveContactsNow();
                    console.log(`📚 [HISTORY] +${added} contact(s) (total : ${Object.keys(botState.contactNames).length})`);
                }
                if (isLatest) console.log(`✅ [HISTORY] Sync complète`);
            } catch (e) { }
        });

        // 📇 LID MAPPING (log seulement les NOUVEAUX)
        sock.ev.on('lid-mapping.update', (map) => {
            try {
                let newOnes = 0;
                for (const [lid, pn] of Object.entries(map || {})) {
                    const lidNum = String(lid).split('@')[0].split(':')[0];
                    const phone = String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
                    if (lidNum && phone && !globalThis.lidPhoneCache.has(lidNum)) {
                        globalThis.lidPhoneCache.set(lidNum, phone);
                        newOnes++;
                    }
                }
                if (newOnes > 0) console.log(`📇 [LID] +${newOnes} (total : ${globalThis.lidPhoneCache.size})`);
            } catch (e) { }
        });

        // 📇 CONTACTS (capture noms, subscribe en queue)
        sock.ev.on('contacts.upsert', async (contacts) => {
            let newNames = 0;
            for (const contact of contacts || []) {
                if (contact.id && contact.notify && contact.notify.trim().length > 1) {
                    if (!botState.contactNames[contact.id]) {
                        botState.contactNames[contact.id] = contact.notify;
                        newNames++;
                    }
                }
                // Subscribe en queue lente
                if (contact.id && !contact.id.endsWith('@g.us')) {
                    enqueueSubscribe(sock, contact.id);
                }
            }
            if (newNames > 0) {
                console.log(`📇 [CONTACTS] +${newNames}`);
                scheduleSaveContacts();
            }
        });

        // 📡 ABONNEMENT PRÉSENCES uniquement pour les contacts qui écrivent
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

                if (jid && !jid.endsWith('@g.us') && jid !== 'status@broadcast') {
                    enqueueSubscribe(sock, jid);
                }
            }
        });

        // 📡 PRÉSENCES
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

        // 📩 MESSAGES
        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (m.type !== 'notify') return;
                await handleMessages(sock, m, botState);
            } catch (e) {
                console.error('⚠️ [MESSAGES] Erreur:', e.message);
            }
        });

        // 📬 ACCUSÉS
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

async function main() {
    botState.loginMode = await askLoginMode();
    if (botState.loginMode === 'existing') botState.loginMode = 'qr';
    startStealthBot();
}

main();
