const { downloadMediaMessage, normalizeMessageContent } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { handleCommands } = require('./commands');

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
    return 'bin';
}

async function handleMessages(sock, m, botState) {
    const msg = m.messages[0];
    if (!msg || !msg.message) return;

    const chatId = msg.key.remoteJid || '';
    const messageId = msg.key.id;
    const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;

    // DOSSIERS ANTI-DELETE
    const DIRS = { antidelete: path.join(botState.LOCAL_DIR, 'Messages_Supprimes') };
    if (!fs.existsSync(DIRS.antidelete)) fs.mkdirSync(DIRS.antidelete, { recursive: true });

    // SAUVEGARDE DES NOMS
    if (!msg.key.fromMe && msg.pushName) {
        const contactJid = msg.key.participant || chatId;
        if (botState.contactNames[contactJid] !== msg.pushName) {
            botState.contactNames[contactJid] = msg.pushName;
            if (!botState.isSavingContacts) {
                botState.isSavingContacts = true;
                fsPromises.writeFile(botState.NAMES_FILE, JSON.stringify(botState.contactNames, null, 2))
                    .catch(()=>{})
                    .finally(() => botState.isSavingContacts = false);
            }
        }
    }

    // CAPTURE DES STATUTS
    if (chatId === 'status@broadcast') {
        const senderJid = msg.key.participant;
        if (!senderJid) return;
        if (!botState.statusCache[senderJid]) botState.statusCache[senderJid] = [];
        botState.statusCache[senderJid].push({ timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000), msg: msg });
        return;
    }

    const content = getRealMessage(msg.message);
    if (!content) return;

    // MISE EN CACHE
    const msgType = Object.keys(content)[0];
    if (messageId) {
        if (botState.cacheMessages.size >= 3000) botState.cacheMessages.delete(botState.cacheMessages.keys().next().value);
        botState.cacheMessages.set(messageId, msg);
    }

    // ANTI-DELETE LOGIC
    if (msgType === 'protocolMessage' && content.protocolMessage?.type === 0) {
        const deletedId = content.protocolMessage.key.id;
        const savedMsg = botState.cacheMessages.get(deletedId);

        if (savedMsg && !savedMsg.key.fromMe) {
            const realDeletedContent = getRealMessage(savedMsg.message);
            if (!realDeletedContent) return;

            const contextName = savedMsg.pushName || "Inconnu";
            const isText = !!(realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text);
            const isImage = !!realDeletedContent.imageMessage;
            const isVideo = !!realDeletedContent.videoMessage;
            const isAudio = !!(realDeletedContent.audioMessage || realDeletedContent.pttMessage);

            if (isText) {
                const textDeleted = realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text || '';
                await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE TEXTE]*\n👤 *De :* ${contextName}\n\n📝 *Message :*\n${textDeleted}` });
            } else if (isImage || isVideo || isAudio) {
                try {
                    const buffer = await downloadMediaMessage(savedMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });
                    if (buffer) {
                        if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: `🦅 *[ANTI-DELETE PHOTO]*\n👤 *De :* ${contextName}` });
                        else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: `🦅 *[ANTI-DELETE VIDÉO]*\n👤 *De :* ${contextName}` });
                        else if (isAudio) {
                            await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE VOCAL]*\n👤 *De :* ${contextName}` });
                            await sock.sendMessage(myJid, { audio: buffer, mimetype: 'audio/ogg', ptt: true });
                        }
                    }
                } catch (err) {}
            }
            if (Object.keys(botState.activeIntervals).length === 0) try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
        }
        return;
    }

    // ROUTAGE VERS LES COMMANDES
    if (msg.key.fromMe) {
        await handleCommands(sock, msg, content, chatId, myJid, botState);
    }
}

module.exports = { handleMessages, getRealMessage };
