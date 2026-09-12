const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    downloadMediaMessage,
    normalizeMessageContent 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

// ==================================================================
// SERVEUR WEB FANTÔME (OBLIGATOIRE POUR RENDER)
// ==================================================================
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Le Noyau Phoenix est actif.'));
app.listen(port, () => console.log(`🌐 Serveur Web actif sur le port ${port}`));

// ==================================================================
// BLOQUEUR DE SPAM TERMINAL
// ==================================================================
const originalLog = console.log;
const originalInfo = console.info;

function filterConsole(originalFunc, ...args) {
    if (args.length > 0) {
        const firstArg = args[0];
        if (typeof firstArg === 'string' && (firstArg.includes('Closing session: SessionEntry') || firstArg.includes('currentRatchet'))) {
            return; 
        }
        if (typeof firstArg === 'object' && firstArg !== null && firstArg.currentRatchet) {
            return;
        }
    }
    originalFunc.apply(console, args);
}
console.log = (...args) => filterConsole(originalLog, ...args);
console.info = (...args) => filterConsole(originalInfo, ...args);

// ==================================================================
// CONFIGURATION DE BASE
// ==================================================================
const PHONE_NUMBER = "22896081989"; 
const START_TIME = Date.now();

// Répertoire de stockage local (adapté pour les serveurs Cloud)
const LOCAL_DIR = path.join(__dirname, 'Phoenix_Media');
const DIRS = {
    antidelete: path.join(LOCAL_DIR, 'Messages_Supprimes'),
    statuses: path.join(LOCAL_DIR, 'Statuts')
};
const NAMES_FILE = path.join(LOCAL_DIR, 'contacts_names.json');

// Création automatique des dossiers
Object.values(DIRS).forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Caches en mémoire vive
const cacheMessages = new Map();
const MAX_CACHE_SIZE = 3000;
const contactNames = {}; 
const activeIntervals = {}; 
const statusCache = {}; 
let isSavingContacts = false;

// Chargement initial des contacts
if (fs.existsSync(NAMES_FILE)) {
    try { Object.assign(contactNames, JSON.parse(fs.readFileSync(NAMES_FILE, 'utf-8'))); } catch {}
}

// Nettoyage périodique du cache des statuts (Toutes les heures)
setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const jid in statusCache) {
        statusCache[jid] = statusCache[jid].filter(s => (now - s.timestamp) < 86400);
        if (statusCache[jid].length === 0) delete statusCache[jid];
    }
}, 60 * 60 * 1000);

// ------------------------------------------------------------------
// FONCTIONS UTILITAIRES
// ------------------------------------------------------------------
function storeMessage(keyId, msg) {
    if (cacheMessages.size >= MAX_CACHE_SIZE) {
        const oldestKey = cacheMessages.keys().next().value;
        cacheMessages.delete(oldestKey);
    }
    cacheMessages.set(keyId, msg);
}

async function saveContactsDebounced() {
    if (isSavingContacts) return;
    isSavingContacts = true;
    try {
        await fsPromises.writeFile(NAMES_FILE, JSON.stringify(contactNames, null, 2));
    } catch (e) {
        console.error("Erreur sauvegarde contacts :", e);
    } finally {
        isSavingContacts = false;
    }
}

function getRealMessage(message) {
    if (!message) return null;
    let normalized = normalizeMessageContent(message);
    if (!normalized) return null;
    while (normalized.ephemeralMessage || normalized.documentWithCaptionMessage) {
        if (normalized.ephemeralMessage) normalized = normalized.ephemeralMessage.message;
        else if (normalized.documentWithCaptionMessage) normalized = normalized.documentWithCaptionMessage.message;
        if (!normalized) return null;
    }
    return normalized;
}

function getMediaExtension(realContent) {
    if (!realContent) return 'bin';
    if (realContent.imageMessage) return 'jpg';
    if (realContent.videoMessage) return 'mp4';
    if (realContent.audioMessage || realContent.pttMessage) return 'ogg';
    if (realContent.stickerMessage) return 'webp';
    if (realContent.documentMessage) return 'pdf';
    return 'bin';
}

function formatUptime(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// ------------------------------------------------------------------
// DÉMARRAGE DU NOYAU PHOENIX STEALTH
// ------------------------------------------------------------------
async function startStealthBot() {
    try {
        console.log('\n📡 [SYSTEM] Initialisation du Noyau Phoenix Stealth (v5.3.1 - Cloud)...');
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

        const sock = makeWASocket({
            logger: pino({ level: 'silent' }), 
            auth: state,
            markOnlineOnConnect: false, 
            syncFullHistory: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            getMessage: async (key) => {
                const stored = cacheMessages.get(key.id);
                return stored?.message || undefined;
            }
        });

        sock.ev.on('creds.update', saveCreds);

        let pairingRequested = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (connection === 'close') {
                pairingRequested = false; 
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('🔄 Reconnexion automatique en cours...');
                    setTimeout(() => startStealthBot(), 3000);
                } else {
                    console.log('❌ Session déconnectée. Il faut un nouveau code.');
                }
            } else if (connection === 'open') {
                console.log('\n==================================================');
                console.log('🦅 PHOENIX ONLINE — STEALTH v5.3.1 (Serveur Actif)');
                console.log('==================================================\n');
                await sock.sendPresenceUpdate('unavailable');
            }

            if (qr === undefined && !sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                setTimeout(async () => {
                    try {
                        console.log("⏳ Demande du code de jumelage...");
                        let code = await sock.requestPairingCode(PHONE_NUMBER);
                        console.log(`\n==================================================`);
                        console.log(`🎯 TON CODE DE JUMELAGE : ${code?.match(/.{1,4}/g)?.join('-')}`);
                        console.log(`==================================================\n`);
                    } catch (err) {
                        console.error("⚠️ Échec de génération du code :", err.message);
                        pairingRequested = false;
                    }
                }, 3000);
            }
        });

        // ------------------------------------------------------------------
        // GESTIONNAIRE DE MESSAGES
        // ------------------------------------------------------------------
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;

            const chatId = msg.key.remoteJid || '';
            const messageId = msg.key.id;
            const senderName = msg.pushName || "Inconnu";
            const myJid = `${PHONE_NUMBER.trim()}@s.whatsapp.net`;
            // Enregistrement des noms uniquement sur les messages entrants
            if (!msg.key.fromMe && msg.pushName) {
                const contactJid = msg.key.participant || chatId;
                if (contactNames[contactJid] !== msg.pushName) {
                    contactNames[contactJid] = msg.pushName;
                    saveContactsDebounced(); 
                }
            }


            if (chatId === 'status@broadcast') {
                const senderJid = msg.key.participant;
                if (!senderJid) return;
                if (!statusCache[senderJid]) statusCache[senderJid] = [];
                statusCache[senderJid].push({
                    timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000),
                    msg: msg
                });
                return;
            }

            const content = getRealMessage(msg.message);
            if (!content) return;

            const msgType = Object.keys(content)[0];
            if (messageId) storeMessage(messageId, msg);

            if (msgType === 'protocolMessage' && content.protocolMessage?.type === 0) {
                const deletedId = content.protocolMessage.key.id;
                const savedMsg = cacheMessages.get(deletedId);

                if (savedMsg && !savedMsg.key.fromMe) {
                    const realDeletedContent = getRealMessage(savedMsg.message);
                    if (!realDeletedContent) return;

                    const contextName = savedMsg.pushName || "Inconnu";
                    const targetJid = savedMsg.key.participant || savedMsg.key.remoteJid;
                    const isText = !!(realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text);
                    const isImage = !!realDeletedContent.imageMessage;
                    const isVideo = !!realDeletedContent.videoMessage;
                    const isAudio = !!(realDeletedContent.audioMessage || realDeletedContent.pttMessage);

                    if (isText) {
                        const textDeleted = realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text || '';
                        const filePath = path.join(DIRS.antidelete, `Texte_${contextName}_${Date.now()}.txt`);
                        fsPromises.writeFile(filePath, `Message supprimé par ${contextName} :\n\n${textDeleted}`).catch(() => {});
                        await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE TEXTE]*\n👤 *De :* ${contextName}\n\n📝 *Message :*\n${textDeleted}`, mentions: [targetJid] });
                    }
                    else if (isImage || isVideo || isAudio) {
                        try {
                            const buffer = await downloadMediaMessage(savedMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });
                            if (buffer) {
                                const ext = getMediaExtension(realDeletedContent);
                                const filePath = path.join(DIRS.antidelete, `Media_${contextName}_${Date.now()}.${ext}`);
                                fsPromises.writeFile(filePath, buffer).catch(() => {});

                                if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: `🦅 *[ANTI-DELETE PHOTO]*\n👤 *De :* ${contextName}` });
                                else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: `🦅 *[ANTI-DELETE VIDÉO]*\n👤 *De :* ${contextName}` });
                                else if (isAudio) {
                                    await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE VOCAL]*\n👤 *De :* ${contextName}` });
                                    await sock.sendMessage(myJid, { audio: buffer, mimetype: 'audio/ogg', ptt: true });
                                }
                            }
                        } catch (err) {}
                    }
                    await sock.sendPresenceUpdate('unavailable');
                }
                return;
            }

            if (msg.key.fromMe) {
                const rawText = content.conversation || content.extendedTextMessage?.text || '';
                const text = rawText.trim().toLowerCase();
                if(!text) return;

                const commandsList = ['!menu', '!type', '!record', '!stop', '!tous', '!spam', '!statut', '!ping', '!runtime', '!clean'];
                if (commandsList.some(cmd => text === cmd || text.startsWith(cmd + ' '))) {
                    try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (err) {}
                }

                const resolveTargetInfo = async (cmdString) => {
                    const arg = rawText.substring(cmdString.length).trim();
                    let targetJid = chatId; 
                    let targetDisplay = "Inconnu";
                    if (arg) {
                        let cleanNumber = arg.replace(/[^0-9]/g, '');
                        targetJid = `${cleanNumber}@s.whatsapp.net`;
                    }
                    if (contactNames[targetJid]) {
                        targetDisplay = contactNames[targetJid];
                    } else if (targetJid.endsWith('@g.us')) {
                        try {
                            const meta = await sock.groupMetadata(targetJid);
                            targetDisplay = meta.subject;
                        } catch {
                            targetDisplay = "Ce Groupe";
                        }
                    } else {
                        targetDisplay = targetJid.split('@')[0];
                    }
                    return { targetJid, targetDisplay };
                };

                if (text === '!ping') {
                    const latence = Date.now() - (msg.messageTimestamp * 1000 || Date.now());
                    await sock.sendMessage(myJid, { text: `🏓 *Pong !*\n⚡ Latence : \`${latence}ms\`\n🦅 *Phoenix Engine v5.3.1*` });
                }
                else if (text === '!runtime' || text === '!uptime') {
                    const uptime = formatUptime(Date.now() - START_TIME);
                    await sock.sendMessage(myJid, { text: `⏱️ *Temps de fonctionnement :*\n\`${uptime}\`` });
                }
                else if (text === '!statut' || text.startsWith('!statut ')) {
                    const query = text.replace('!statut', '').trim();
                    if (!query) {
                        const authors = Object.keys(statusCache);
                        if (authors.length === 0) {
                            await sock.sendMessage(myJid, { text: "📭 *[GHOST STATUS]* Aucun statut récent en mémoire RAM." });
                        } else {
                            let msgList = "🦅 *STATUTS CAPTURÉS EN MÉMOIRE (Top 10)* :\n\n";
                            authors.slice(-10).forEach((jid, i) => {
                                const name = contactNames[jid] || "Inconnu";
                                const count = statusCache[jid].length;
                                msgList += `${i + 1}. ${name} (${jid.split('@')[0]}) ➜ ${count} statut(s)\n`;
                            });
                            msgList += "\n_Tape `!statut [nom/n°]` pour consulter un contact._";
                            await sock.sendMessage(myJid, { text: msgList });
                        }
                    } else {
                        const matches = Object.entries(contactNames).filter(([jid, name]) => 
                            name.toLowerCase().includes(query.toLowerCase()) || jid.includes(query)
                        ).map(([jid, name]) => ({ jid, name }));

                        if (matches.length === 0) {
                            await sock.sendMessage(myJid, { text: `⚠️ Aucun contact trouvé pour : "${query}".` });
                        } else {
                            const targetJid = matches[0].jid;
                            const targetName = matches[0].name;
                            const userStatuses = statusCache[targetJid];

                            if (!userStatuses || userStatuses.length === 0) {
                                await sock.sendMessage(myJid, { text: `🕵️‍♂️ Aucun statut récent pour : ${targetName}` });
                            } else {
                                await sock.sendMessage(myJid, { text: `🦅 *Envoi des statuts de ${targetName}...*` });
                                for (let sObj of userStatuses) {
                                    let sContent = getRealMessage(sObj.msg.message);
                                    if (!sContent) continue;
                                    let isText = !!(sContent.extendedTextMessage?.text || sContent.conversation);
                                    let isImage = !!sContent.imageMessage;
                                    let isVideo = !!sContent.videoMessage;
                                    let isAudio = !!(sContent.audioMessage || sContent.pttMessage);

                                    if (isText) {
                                        await sock.sendMessage(myJid, { text: `📝 *Statut (${targetName})*:\n\n${sContent.extendedTextMessage?.text || sContent.conversation}` });
                                    } else if (isImage || isVideo || isAudio) {
                                        try {
                                            const buffer = await downloadMediaMessage(sObj.msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });
                                            const originalCaption = sContent.imageMessage?.caption || sContent.videoMessage?.caption || "";
                                            const displayCaption = originalCaption ? `\n\n📝 *Légende :*\n${originalCaption}` : "";

                                            if (isImage) {
                                                await sock.sendMessage(myJid, { image: buffer, caption: `📸 *PHOTO (${targetName})*${displayCaption}` });
                                            } else if (isVideo) {
                                                await sock.sendMessage(myJid, { video: buffer, caption: `🎥 *VIDÉO (${targetName})*${displayCaption}` });
                                            } else if (isAudio) {
                                                await sock.sendMessage(myJid, { text: `🎙️ *VOCAL (${targetName})*` });
                                                await sock.sendMessage(myJid, { audio: buffer, mimetype: 'audio/ogg', ptt: true });
                                            }
                                        } catch (e) {}
                                    }
                                    await new Promise(res => setTimeout(res, 800)); 
                                }
                            }
                        }
                    }
                }
                else if (text.startsWith('!type')) {
                    const { targetJid, targetDisplay } = await resolveTargetInfo('!type');
                    if (activeIntervals[targetJid]) clearInterval(activeIntervals[targetJid]);
                    await sock.sendPresenceUpdate('composing', targetJid);
                    activeIntervals[targetJid] = setInterval(async () => { await sock.sendPresenceUpdate('composing', targetJid); }, 8000);
                    await sock.sendMessage(myJid, { text: `✍️ *Ghost Type activé pour :* ${targetDisplay}` });
                }
                else if (text.startsWith('!record')) {
                    const { targetJid, targetDisplay } = await resolveTargetInfo('!record');
                    if (activeIntervals[targetJid]) clearInterval(activeIntervals[targetJid]);
                    await sock.sendPresenceUpdate('recording', targetJid);
                    activeIntervals[targetJid] = setInterval(async () => { await sock.sendPresenceUpdate('recording', targetJid); }, 8000);
                    await sock.sendMessage(myJid, { text: `🎙️ *Ghost Record activé pour :* ${targetDisplay}` });
                }
                else if (text.startsWith('!stop')) {
                    const { targetJid, targetDisplay } = await resolveTargetInfo('!stop');
                    if (activeIntervals[targetJid]) { clearInterval(activeIntervals[targetJid]); delete activeIntervals[targetJid]; }
                    await sock.sendPresenceUpdate('paused', targetJid);
                    await sock.sendMessage(myJid, { text: `🛑 *Simulations arrêtées pour :* ${targetDisplay}` });
                }
                else if (text === '!tous' && chatId.endsWith('@g.us')) {
                    try {
                        const metadata = await sock.groupMetadata(chatId);
                        let txt = `📢 *NOTIFICATION GLOBALE (${metadata.subject})* :\n\n`;
                        metadata.participants.forEach((p, i) => { txt += `${i + 1}. @${p.id.split('@')[0]}\n`; });
                        await sock.sendMessage(chatId, { text: txt, mentions: metadata.participants.map(p => p.id) });
                    } catch (e) {
                        await sock.sendMessage(myJid, { text: "❌ Échec de la notification globale." });
                    }
                }
                else if (text.startsWith('!spam ')) {
                    const args = rawText.trim().split(' ');
                    const count = parseInt(args[1]);
                    const spamTxt = args.slice(2).join(' ');

                    if (isNaN(count) || !spamTxt) {
                        await sock.sendMessage(myJid, { text: "⚠️ *Usage correct :* `!spam [nombre] [votre texte]`" });
                    } else {
                        const limit = Math.min(count, 30); 
                        await sock.sendMessage(myJid, { text: `⚡ Envoi de ${limit} messages en cours...` });
                        for (let i = 0; i < limit; i++) {
                            await sock.sendMessage(chatId, { text: spamTxt });
                            await new Promise(res => setTimeout(res, 600)); 
                        }
                    }
                }
                else if (text === '!clean') {
                    cacheMessages.clear();
                    await sock.sendMessage(myJid, { text: "🧹 *Cache mémoire RAM vidé avec succès !*" });
                }
                else if (text === '!menu' || text === '!help') {
                    const mText = `🦅 *PHOENIX CONTROL HUB v5.3.1* 🦅\n\n` +
                        `⚡ *COMMANDES DE CONTROLE :*\n` +
                        `• \`!statut\` ➜ Consulte la mémoire des statuts.\n` +
                        `• \`!statut [nom]\` ➜ Récupère les statuts d'un contact.\n` +
                        `• \`!type [n°]\` ➜ Simule "Écrit..." en continu.\n` +
                        `• \`!record [n°]\` ➜ Simule "Enregistre un vocal...".\n` +
                        `• \`!stop [n°]\` ➜ Arrête toute simulation.\n` +
                        `• \`!tous\` ➜ Mentionne tout le monde dans un groupe.\n` +
                        `• \`!spam [n] [texte]\` ➜ Envoie [n] messages en rafale.\n` +
                        `• \`!ping\` ➜ Affiche la latence du bot.\n` +
                        `• \`!runtime\` ➜ Temps d'activité du noyau.\n` +
                        `• \`!clean\` ➜ Libère la mémoire RAM.\n\n` +
                        `📁 *Stockage cloud :*\n\`${LOCAL_DIR}\``;
                    
                    await sock.sendMessage(myJid, { text: mText });
                }
                
                await sock.sendPresenceUpdate('unavailable');
            }
        });

    } catch (err) {
        console.error("❌ ERREUR CRITIQUE :", err.message || err.toString());
        setTimeout(() => startStealthBot(), 5000);
    }
}

startStealthBot();
