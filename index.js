const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser, fetchLatestBaileysVersion, downloadContentFromMessage } = require('toxic-baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

const { handleMessages, handleReceipts } = require('./core/messages');
const { cacheMessage, getCachedMessage, archiveText, archiveMedia, ARCHIVE_BASE } = require('./core/antiDelete');
const { cacheStatus } = require('./core/antiStatus');
const { updatePresence } = require('./core/presenceTracker');
const { loadContacts, getContactName } = require('./core/contacts');

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

const originalLog = console.log;
console.log = (...args) => {
    if (typeof args[0] === 'string' && (args[0].includes('Closing session:') || args[0].includes('currentRatchet'))) return;
    originalLog.apply(console, args);
};

// ==========================================
// ÉTAT GLOBAL
// ==========================================
const LOCAL_DIR = path.join(__dirname, 'Phoenix_Media');
if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });

loadContacts();

const botState = {
    PHONE_NUMBER: process.env.PHONE_NUMBER || "22896081989",
    START_TIME: Date.now(),
    LOCAL_DIR,
    cacheMessages: new Map(),
    activeIntervals: {},
    statusCache: {},
    currentSock: null,
    recentMedia: new Map(),
    activePresence: new Map(),
    antiDeleteEnabled: true,
    subscribedJids: new Set(),
    capturedGroups: new Set()
};

global.botState = botState;
globalThis.lidPhoneCache = new Map();

// ==========================================
// ENVOI VERS TON DM
// ==========================================
async function sendToOwner(sock, text) {
    const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
    if (!botJid) return;
    if (text) await sock.sendMessage(botJid, { text });
}

// ==========================================
// FORWARD MÉDIA VERS DM + ARCHIVAGE
// ==========================================
async function forwardAndArchive(sock, content, mediaType, caption, senderName, chatName) {
    const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
    if (!botJid) return;

    let buffer = null;
    try {
        const stream = await downloadContentFromMessage(content[mediaType + 'Message'], mediaType);
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        buffer = Buffer.concat(chunks);
    } catch (e) {
        console.error(`⚠️ Download ${mediaType} échoué:`, e.message);
        await sock.sendMessage(botJid, { text: caption + '\n\n⚠️ (média non téléchargeable — WhatsApp a peut-être bloqué)' });
        return;
    }

    // Archivage disque
    let archivePath = null;
    if (buffer) {
        // Extensions selon le type
        let ext = null;
        if (mediaType === 'image') ext = content.imageMessage?.mimetype?.split('/')[1]?.split(';')[0] || 'jpg';
        else if (mediaType === 'video') ext = 'mp4';
        else if (mediaType === 'audio') ext = 'ogg';
        else if (mediaType === 'sticker') ext = 'webp';

        archivePath = archiveMedia(buffer, mediaType, senderName, chatName, ext);
    }

    const archiveLine = archivePath
        ? `\n💾 Archivé : ${path.basename(archivePath)}`
        : '';

    const finalCaption = caption + archiveLine;

    // Envoi au DM
    if (mediaType === 'image') {
        await sock.sendMessage(botJid, { image: buffer, caption: finalCaption });
    } else if (mediaType === 'video') {
        await sock.sendMessage(botJid, { video: buffer, caption: finalCaption });
    } else if (mediaType === 'audio') {
        await sock.sendMessage(botJid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
        await sock.sendMessage(botJid, { text: finalCaption });
    } else if (mediaType === 'sticker') {
        await sock.sendMessage(botJid, { sticker: buffer });
        await sock.sendMessage(botJid, { text: finalCaption });
    }
}

// ==========================================
// MOTEUR DE CONNEXION
// ==========================================
let reconnectTimer = null;

async function startStealthBot() {
    try {
        console.log('\n📡 [SYSTEM] Initialisation du Noyau Phoenix Stealth...');
        console.log(`📁 Dossier archive : ${ARCHIVE_BASE}`);

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
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            getMessage: async (key) => botState.cacheMessages.get(key.id)?.message || undefined
        });

        botState.currentSock = sock;
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('lid-mapping.update', (map) => {
            try {
                for (const [lid, pn] of Object.entries(map || {})) {
                    const lidNum = String(lid).split('@')[0].split(':')[0];
                    const phone = String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
                    if (lidNum && phone) globalThis.lidPhoneCache.set(lidNum, phone);
                }
            } catch (e) {}
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.clear();
                console.log('\n📱 SCANNE CE QR CODE avec WhatsApp\n');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                for (const jid in botState.activeIntervals) clearInterval(botState.activeIntervals[jid]);
                botState.activeIntervals = {};
                if (botState.currentSock === sock) botState.currentSock = null;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`🔌 Connexion fermée. Code: ${statusCode}`);

                if (statusCode === 401 && !shouldReconnect) {
                    try {
                        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    } catch (e) {}
                }

                let delay = 3000;
                let shouldRestart = true;
                if (statusCode === 515) delay = 2000;
                else if (statusCode === 440) delay = 15000;
                else if (!shouldReconnect) shouldRestart = false;

                if (shouldRestart && !reconnectTimer) {
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        startStealthBot();
                    }, delay);
                }

            } else if (connection === 'open') {
                console.log('\n🦅 PHOENIX ONLINE\n');
                try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
            }
        });

        // ==========================================
        // ABONNEMENT PRÉSENCES
        // ==========================================
        sock.ev.on('contacts.upsert', async (contacts) => {
            for (const contact of contacts) {
                if (contact.id && !botState.subscribedJids.has(contact.id)) {
                    try {
                        await sock.presenceSubscribe(contact.id);
                        botState.subscribedJids.add(contact.id);
                    } catch (e) {}
                }
            }
        });

        // ==========================================
        // MESSAGES
        // ==========================================
        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (m.type !== 'notify') return;

                for (const msg of m.messages) {
                    if (!msg || !msg.message) continue;

                    const chatJid = msg.key?.remoteJid;
                    const senderJid = msg.key?.participant || chatJid;

                    // Présence auto
                    if (chatJid && chatJid !== 'status@broadcast' && !chatJid.endsWith('@g.us')) {
                        if (!botState.subscribedJids.has(chatJid)) {
                            try {
                                await sock.presenceSubscribe(chatJid);
                                botState.subscribedJids.add(chatJid);
                            } catch (e) {}
                        }
                    }

                    // Cache anti-delete
                    if (botState.antiDeleteEnabled) cacheMessage(msg);

                    // Statuts
                    if (chatJid === 'status@broadcast') {
                        cacheStatus(msg);
                        continue;
                    }

                    // ==========================================
                    // DÉTECTION REVOKE (message supprimé)
                    // ==========================================
                    const protocolMsg = msg.message?.protocolMessage;
                    if (protocolMsg && protocolMsg.type === 'REVOKE') {
                        const revokedKey = protocolMsg.key;
                        if (revokedKey) {
                            const cached = getCachedMessage(revokedKey.remoteJid, revokedKey.id);
                            if (cached) {
                                // Récupère le nom de l'expéditeur et du chat
                                const senderJidFull = cached.key.participant || cached.key.remoteJid;
                                const senderName = getContactName(senderJidFull);

                                // Nom du chat
                                let chatName = 'DM';
                                if ((cached.key.remoteJid || '').endsWith('@g.us')) {
                                    chatName = getContactName(cached.key.remoteJid);
                                } else {
                                    chatName = 'Discussion privée';
                                }

                                const ts = new Date(Number(cached.messageTimestamp) * 1000).toLocaleString('fr-FR');
                                const senderNum = senderJidFull.split('@')[0].split(':')[0];

                                let caption = `🗑️ *Message supprimé*\n` +
                                              `👤 De : ${senderName} (@${senderNum})\n` +
                                              `💬 Dans : ${chatName}\n` +
                                              `🕐 Le : ${ts}`;

                                const content = cached.message;
                                const type = Object.keys(content)[0];

                                // Texte
                                if (type === 'conversation' || type === 'extendedTextMessage') {
                                    const textContent = content.conversation || content.extendedTextMessage?.text || '';
                                    const archivePath = archiveText(textContent, senderName, chatName);
                                    const archiveLine = archivePath ? `\n💾 Archivé : ${path.basename(archivePath)}` : '';
                                    await sendToOwner(sock, `${caption}${archiveLine}\n\n📝 Contenu :\n${textContent}`);
                                }
                                // Médias
                                else if (['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage'].includes(type)) {
                                    const mediaType = type.replace('Message', '');
                                    await forwardAndArchive(sock, content, mediaType, caption, senderName, chatName);
                                }
                                // Autres types
                                else {
                                    await sendToOwner(sock, `${caption}\n\n⚠️ Type non supporté : ${type}`);
                                }
                            }
                        }
                    }

                    // ==========================================
                    // VIEW ONCE AUTO
                    // ==========================================
                    const viewOnceWrappers = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
                    let viewOnceContent = null;
                    for (const w of viewOnceWrappers) {
                        if (msg.message[w]?.message) {
                            viewOnceContent = msg.message[w].message;
                            break;
                        }
                    }

                    if (viewOnceContent) {
                        const innerType = Object.keys(viewOnceContent)[0];
                        if (['imageMessage', 'videoMessage'].includes(innerType)) {
                            const mediaType = innerType.replace('Message', '');
                            const senderJidFull = msg.key.participant || msg.key.remoteJid;
                            const senderName = getContactName(senderJidFull);

                            let chatName = 'DM';
                            if ((msg.key.remoteJid || '').endsWith('@g.us')) {
                                chatName = getContactName(msg.key.remoteJid);
                            } else {
                                chatName = 'Discussion privée';
                            }

                            const ts = new Date(Number(msg.messageTimestamp) * 1000).toLocaleString('fr-FR');

                            const caption = `👁️ *View Once capturé*\n` +
                                           `👤 De : ${senderName}\n` +
                                           `💬 Dans : ${chatName}\n` +
                                           `🕐 Le : ${ts}`;

                            await forwardAndArchive(sock, viewOnceContent, mediaType, caption, senderName, chatName);
                        }
                    }

                    // Traitement commandes
                    await handleMessages(sock, { type: m.type, messages: [msg] }, botState);
                }
            } catch (e) {
                console.error('⚠️ [MESSAGES] Erreur non bloquante:', e.message);
            }
        });

        // ==========================================
        // PRÉSENCES
        // ==========================================
        sock.ev.on('presence.update', ({ id, presences }) => {
            try {
                for (const [participantJid, presence] of Object.entries(presences || {})) {
                    updatePresence(participantJid, presence);
                }
            } catch (e) {}
        });

        sock.ev.on('message-receipt.update', (events) => {
            try {
                if (handleReceipts) handleReceipts(events, botState);
            } catch (e) {}
        });

    } catch (err) {
        console.error('🔥 Erreur startStealthBot:', err);
        if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 5000);
    }
}

startStealthBot();
