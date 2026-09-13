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

async function handleMessages(sock, m, botState) {
    const msg = m.messages[0];
    if (!msg || !msg.message) return;

    const chatId = msg.key.remoteJid || '';
    const messageId = msg.key.id;
    const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;

    const DIRS = { antidelete: path.join(botState.LOCAL_DIR, 'Messages_Supprimes') };
    if (!fs.existsSync(DIRS.antidelete)) fs.mkdirSync(DIRS.antidelete, { recursive: true });

    // Sauvegarde des noms
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

    // CAPTURE DES STATUTS (Ajout du flag seen: false)
    if (chatId === 'status@broadcast') {
        const senderJid = msg.key.participant;
        if (!senderJid) return;
        if (!botState.statusCache[senderJid]) botState.statusCache[senderJid] = [];
        
        // On évite les doublons d'ID
        const exists = botState.statusCache[senderJid].some(s => s.id === messageId);
        if (!exists) {
            botState.statusCache[senderJid].push({ 
                id: messageId,
                timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000), 
                msg: msg,
                seen: false 
            });
        }
        return;
    }

    const content = getRealMessage(msg.message);
    if (!content) return;

    const msgType = Object.keys(content)[0];
    if (messageId) {
        if (botState.cacheMessages.size >= 3000) botState.cacheMessages.delete(botState.cacheMessages.keys().next().value);
        botState.cacheMessages.set(messageId, msg);
    }

    // ANTI-DELETE
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

    if (msg.key.fromMe) {
        await handleCommands(sock, msg, content, chatId, myJid, botState);
    }
}

// SYNCHRONISATION DES ACCUSÉS DE LECTURE (READ RECEIPTS)
function handleReceipts(events, botState) {
    for (const receipt of events) {
        const targetId = receipt.key.id;
        
        // On parcourt la mémoire des statuts pour marquer vu = true
        for (const jid in botState.statusCache) {
            const item = botState.statusCache[jid].find(s => s.id === targetId);
            if (item) {
                item.seen = true;
                break;
            }
        }
    }
}

module.exports = { handleMessages, handleReceipts, getRealMessage };
