const { downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { handleCommand, commands } = require('./commands');

const OWNER_NUMBER = process.env.OWNER_NUMBER || '22896081989';
const PREFIX = '!';

function unwrapMessageInPlace(msg) {
    if (!msg || !msg.message) return msg;
    let inner = msg.message;
    let isVO = false;
    let changed = true;

    while (changed) {
        changed = false;
        if (inner.ephemeralMessage?.message) { inner = inner.ephemeralMessage.message; changed = true; }
        if (inner.documentWithCaptionMessage?.message) { inner = inner.documentWithCaptionMessage.message; changed = true; }
        if (inner.viewOnceMessage?.message) { inner = inner.viewOnceMessage.message; isVO = true; changed = true; }
        if (inner.viewOnceMessageV2?.message) { inner = inner.viewOnceMessageV2.message; isVO = true; changed = true; }
        if (inner.viewOnceMessageV2Extension?.message) { inner = inner.viewOnceMessageV2Extension.message; isVO = true; changed = true; }
        if (inner.viewOnceMessageV3?.message) { inner = inner.viewOnceMessageV3.message; isVO = true; changed = true; }
        if (inner.ptvMessage) { inner = { videoMessage: inner.ptvMessage }; isVO = true; changed = true; }
    }

    if (inner.imageMessage?.viewOnce || inner.videoMessage?.viewOnce || inner.audioMessage?.viewOnce) isVO = true;

    for (const key in inner) {
        if (inner[key] && typeof inner[key] === 'object' && 'viewOnce' in inner[key]) {
            inner[key].viewOnce = false;
        }
    }

    msg.message = inner;
    msg.wasViewOnce = isVO;
    return msg;
}

function getDisplayName(jid, botState, pushName = null) {
    if (!jid) return { name: 'Inconnu', num: '?' };
    const num = jid.split('@')[0].split(':')[0];

    if (botState.contactNames[jid]) {
        return { name: botState.contactNames[jid], num };
    }

    if (jid.endsWith('@lid')) {
        const cached = globalThis.lidPhoneCache?.get(num);
        if (cached) {
            const realJid = cached + '@s.whatsapp.net';
            const realName = botState.contactNames[realJid] || cached;
            return { name: realName, num: cached };
        }
    }

    if (pushName && pushName !== '.' && pushName.trim().length > 1) {
        return { name: pushName, num };
    }

    return { name: `Contact ${num.slice(-4)}`, num };
}

function getChatName(chatId, botState) {
    if (!chatId) return 'Privé';
    if (chatId.endsWith('@g.us')) {
        return botState.contactNames[chatId] || 'Groupe';
    }
    return 'Privé';
}

function isQuotedViewOnce(quotedMsg) {
    if (!quotedMsg) return false;
    if (quotedMsg.viewOnceMessage) return true;
    if (quotedMsg.viewOnceMessageV2) return true;
    if (quotedMsg.viewOnceMessageV2Extension) return true;
    if (quotedMsg.viewOnceMessageV3) return true;
    if (quotedMsg.ptvMessage) return true;
    if (quotedMsg.imageMessage?.viewOnce) return true;
    if (quotedMsg.videoMessage?.viewOnce) return true;
    if (quotedMsg.audioMessage?.viewOnce) return true;
    return false;
}

// ==========================================
// CONSTRUCTION DE LA CAPTION AVEC LÉGENDE OPTIONNELLE
// ==========================================
function buildCaption(header, caption) {
    const cleanCaption = (caption || '').trim();
    if (cleanCaption) {
        return `${header}\n\n📝 *Légende :*\n${cleanCaption}`;
    }
    return header;
}

async function handleMessages(sock, m, botState) {
    if (m.type !== 'notify') return;

    for (const rawMsg of m.messages) {
        if (!rawMsg || !rawMsg.message) continue;
        try {
            await processSingleMessage(sock, rawMsg, botState);
        } catch (e) {
            console.error('⚠️ Erreur traitement message:', e.message);
        }
    }
}

async function processSingleMessage(sock, rawMsg, botState) {
    let msg = unwrapMessageInPlace(JSON.parse(JSON.stringify(rawMsg)));

    const content = msg.message;
    if (!content) return;
    const msgType = Object.keys(content)[0];

    const chatId = msg.key.remoteJid || '';
    const messageId = msg.key.id;
    const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
    const isFromMe = msg.key.fromMe;
    const isGroup = chatId.endsWith('@g.us');
    const sender = isGroup ? msg.key.participant : chatId;
    const senderNumber = sender ? sender.split('@')[0].split(':')[0] : '';
    const isOwner = isFromMe || senderNumber === OWNER_NUMBER;

    // CAPTURE AUTO DES CONTACTS
    if (!isFromMe && msg.pushName) {
        const rawJid = msg.key.participant || chatId;
        const contactJid = jidNormalizedUser(rawJid);
        if (contactJid && !botState.contactNames[contactJid]) {
            botState.contactNames[contactJid] = msg.pushName;
            if (!botState.isSavingContacts) {
                botState.isSavingContacts = true;
                fsPromises.writeFile(botState.NAMES_FILE, JSON.stringify(botState.contactNames, null, 2))
                    .catch(() => { })
                    .finally(() => botState.isSavingContacts = false);
            }
        }
    }

    // ==========================================
    // STATUTS
    // ==========================================
    if (chatId === 'status@broadcast') {
        const rawSender = msg.key.participant;
        if (!rawSender) return;
        const senderJid = jidNormalizedUser(rawSender);

        // STATUT SUPPRIMÉ
        if (msgType === 'protocolMessage' && content.protocolMessage?.type === 0) {
            const deletedId = content.protocolMessage.key.id;
            if (botState.statusCache[senderJid]) {
                const savedStatusObj = botState.statusCache[senderJid].find(s => s.id === deletedId);
                if (savedStatusObj) {
                    const displayInfo = getDisplayName(senderJid, botState, savedStatusObj.senderName);
                    const headerInfo = `👤 *De :* *${displayInfo.name}*\n📢 *[STATUT SUPPRIMÉ]*`;

                    if (savedStatusObj.type === 'text') {
                        await sock.sendMessage(myJid, { text: buildCaption(headerInfo, savedStatusObj.text) });
                    } else if (savedStatusObj.localPath && fs.existsSync(savedStatusObj.localPath)) {
                        const buffer = fs.readFileSync(savedStatusObj.localPath);
                        const caption = buildCaption(headerInfo, savedStatusObj.caption);

                        if (savedStatusObj.type === 'image') await sock.sendMessage(myJid, { image: buffer, caption });
                        else if (savedStatusObj.type === 'video') await sock.sendMessage(myJid, { video: buffer, caption });
                        else if (savedStatusObj.type === 'audio') {
                            await sock.sendMessage(myJid, { text: headerInfo });
                            await sock.sendMessage(myJid, { audio: buffer, mimetype: savedStatusObj.mimetype || 'audio/ogg; codecs=opus', ptt: savedStatusObj.ptt });
                        }
                    }
                    savedStatusObj.seen = true;
                }
            }
            return;
        }

        // NOUVEAU STATUT → capture en cache
        const isText = !!(content.extendedTextMessage?.text || content.conversation);
        const isImage = !!content.imageMessage;
        const isVideo = !!content.videoMessage;
        const isAudio = !!(content.audioMessage || content.pttMessage);

        if (!isText && !isImage && !isVideo && !isAudio) return;

        if (!botState.statusCache[senderJid]) botState.statusCache[senderJid] = [];
        const exists = botState.statusCache[senderJid].some(s => s.id === messageId);

        if (!exists) {
            let localPath = null;
            let mediaType = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'text';

            if (mediaType !== 'text') {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    const ext = isImage ? '.jpg' : isVideo ? '.mp4' : '.ogg';
                    localPath = path.join(botState.DIRS.statuts, `${messageId}${ext}`);
                    fs.writeFileSync(localPath, buffer);
                } catch (e) { }
            }

            // ✅ CAPTURE DE LA LÉGENDE POUR LES STATUTS
            const statusCaption = content.imageMessage?.caption
                                || content.videoMessage?.caption
                                || '';

            const statusObj = {
                id: messageId,
                timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000),
                senderName: msg.pushName || botState.contactNames[senderJid] || "Inconnu",
                type: mediaType,
                localPath: localPath,
                text: content.extendedTextMessage?.text || content.conversation || '',
                caption: statusCaption,
                mimetype: content.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
                ptt: content.audioMessage?.ptt || content.pttMessage?.ptt || false,
                seen: false
            };

            botState.statusCache[senderJid].push(statusObj);

            if (!botState.isSavingStatus) {
                botState.isSavingStatus = true;
                fsPromises.writeFile(botState.STATUS_JSON, JSON.stringify(botState.statusCache, null, 2))
                    .catch(() => { })
                    .finally(() => botState.isSavingStatus = false);
            }
        }
        return;
    }

    // CACHE ANTI-DELETE
    if (messageId) {
        if (botState.cacheMessages.size >= 3000) botState.cacheMessages.delete(botState.cacheMessages.keys().next().value);
        botState.cacheMessages.set(messageId, rawMsg);
    }

    // ==========================================
    // REPLY-VO (avec légende)
    // ==========================================
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
        || msg.message?.imageMessage?.contextInfo
        || msg.message?.videoMessage?.contextInfo
        || msg.message?.stickerMessage?.contextInfo
        || msg.message?.audioMessage?.contextInfo
        || msg.message?.documentMessage?.contextInfo;

    if (isFromMe && contextInfo?.quotedMessage && isQuotedViewOnce(contextInfo.quotedMessage)) {
        console.log('🦅 [REPLY-VO] Toi → récupération...');
        const quotedMsg = contextInfo.quotedMessage;
        const quotedId = contextInfo.stanzaId;
        const quotedParticipant = contextInfo.participant;

        try {
            const fakeMsg = {
                key: { remoteJid: chatId, fromMe: false, id: quotedId, participant: quotedParticipant },
                message: quotedMsg
            };
            const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {}, {
                logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest
            });

            if (buffer && buffer.length > 0) {
                const inner = quotedMsg.viewOnceMessageV2?.message
                    || quotedMsg.viewOnceMessage?.message
                    || quotedMsg.viewOnceMessageV2Extension?.message
                    || quotedMsg.viewOnceMessageV3?.message
                    || (quotedMsg.ptvMessage ? { videoMessage: quotedMsg.ptvMessage } : null)
                    || quotedMsg;
                const type = Object.keys(inner)[0];
                const displayInfo = getDisplayName(quotedParticipant || chatId, botState);
                const chatName = getChatName(chatId, botState);

                const headerInfo = `🦅 *Vue unique récupérée*\n👤 De : *${displayInfo.name}*\n💬 Dans : ${chatName}`;

                // ✅ CAPTURE DE LA LÉGENDE
                const voCaption = inner.imageMessage?.caption
                                || inner.videoMessage?.caption
                                || '';
                const finalCaption = buildCaption(headerInfo, voCaption);

                if (type === 'imageMessage') {
                    await sock.sendMessage(myJid, { image: buffer, caption: finalCaption });
                } else if (type === 'videoMessage') {
                    await sock.sendMessage(myJid, { video: buffer, caption: finalCaption });
                } else if (type === 'audioMessage' || type === 'pttMessage') {
                    const meta = inner.audioMessage || inner.pttMessage;
                    await sock.sendMessage(myJid, { text: headerInfo });
                    await sock.sendMessage(myJid, { audio: buffer, mimetype: meta?.mimetype || 'audio/ogg; codecs=opus', ptt: true });
                }
                console.log(`✅ [REPLY-VO] Envoyé (${displayInfo.name})${voCaption ? ' + légende' : ''}`);
            }
        } catch (e) {
            console.error(`❌ [REPLY-VO] Erreur : ${e.message}`);
        }
    }

    // ==========================================
    // VUE UNIQUE AUTO (avec légende)
    // ==========================================
    if (msg.wasViewOnce && !isFromMe) {
        const displayInfo = getDisplayName(sender, botState, msg.pushName);
        const chatName = getChatName(chatId, botState);
        const headerInfo = `👤 *De :* *${displayInfo.name}*\n💬 Dans : ${chatName}`;

        const isImage = !!content.imageMessage;
        const isVideo = !!content.videoMessage;
        const isAudio = !!(content.audioMessage || content.pttMessage);

        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });

            // ✅ CAPTURE DE LA LÉGENDE
            const mediaCaption = content.imageMessage?.caption || content.videoMessage?.caption || '';
            const finalCaption = buildCaption(headerInfo, mediaCaption);

            if (buffer) {
                if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: finalCaption });
                else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: finalCaption });
                else if (isAudio) {
                    const audioMeta = content.audioMessage || content.pttMessage;
                    await sock.sendMessage(myJid, { text: headerInfo });
                    await sock.sendMessage(myJid, { audio: buffer, mimetype: audioMeta?.mimetype || 'audio/ogg; codecs=opus', ptt: audioMeta?.ptt || false });
                }
            }
        } catch (err) { }
    }

    // ==========================================
    // ANTI-DELETE COMPLET (avec légende)
    // ==========================================
    if (msgType === 'protocolMessage' && content.protocolMessage?.type === 0) {
        const deletedId = content.protocolMessage.key.id;
        const savedMsg = botState.cacheMessages.get(deletedId);

        if (savedMsg && !savedMsg.key.fromMe) {
            const savedUnwrapped = unwrapMessageInPlace(JSON.parse(JSON.stringify(savedMsg)));
            const realDeletedContent = savedUnwrapped.message;
            const targetChatId = savedMsg.key.remoteJid;
            const rawSender = savedMsg.key.participant || targetChatId;
            const senderJid = jidNormalizedUser(rawSender);
            const displayInfo = getDisplayName(senderJid, botState, savedMsg.pushName);
            const chatName = getChatName(targetChatId, botState);
            const headerInfo = `👤 *De :* *${displayInfo.name}*\n💬 Dans : ${chatName}`;

            const isText = !!(realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text);
            const isImage = !!realDeletedContent.imageMessage;
            const isVideo = !!realDeletedContent.videoMessage;
            const isAudio = !!(realDeletedContent.audioMessage || realDeletedContent.pttMessage);
            const isSticker = !!realDeletedContent.stickerMessage;
            const isDocument = !!realDeletedContent.documentMessage;
            const isContact = !!realDeletedContent.contactMessage;
            const isLocation = !!realDeletedContent.locationMessage;

            if (isText) {
                const textDeleted = realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text || '';
                await sock.sendMessage(myJid, { text: `🦅 *[MESSAGE SUPPRIMÉ]*\n${headerInfo}\n\n📝 *Contenu :*\n${textDeleted}` });
            } else if (isImage || isVideo || isAudio || isSticker || isDocument) {
                try {
                    const buffer = await downloadMediaMessage(
                        { key: savedMsg.key, message: realDeletedContent },
                        'buffer', {},
                        { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest }
                    );

                    // ✅ CAPTURE DE LA LÉGENDE
                    const mediaCaption = realDeletedContent.imageMessage?.caption
                                      || realDeletedContent.videoMessage?.caption
                                      || realDeletedContent.documentMessage?.caption
                                      || '';
                    const finalCaption = buildCaption(headerInfo, mediaCaption);

                    if (buffer) {
                        if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: finalCaption });
                        else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: finalCaption });
                        else if (isAudio) {
                            const audioMeta = realDeletedContent.audioMessage || realDeletedContent.pttMessage;
                            await sock.sendMessage(myJid, { text: headerInfo });
                            await sock.sendMessage(myJid, { audio: buffer, mimetype: audioMeta?.mimetype || 'audio/ogg; codecs=opus', ptt: audioMeta?.ptt || false });
                        } else if (isSticker) {
                            await sock.sendMessage(myJid, { text: headerInfo });
                            await sock.sendMessage(myJid, { sticker: buffer });
                        } else if (isDocument) {
                            const docName = realDeletedContent.documentMessage.fileName || 'Fichier';
                            const docMime = realDeletedContent.documentMessage.mimetype || 'application/octet-stream';
                            await sock.sendMessage(myJid, { text: finalCaption });
                            await sock.sendMessage(myJid, { document: buffer, mimetype: docMime, fileName: docName });
                        }
                    }
                } catch (err) {
                    await sock.sendMessage(myJid, { text: `🦅 *[ERREUR MEDIA]*\n${headerInfo}\n⚠️ *Impossible de télécharger.*` });
                }
            } else if (isContact) {
                await sock.sendMessage(myJid, { text: `🦅 *[CONTACT SUPPRIMÉ]*\n${headerInfo}` });
            } else if (isLocation) {
                await sock.sendMessage(myJid, { text: `🦅 *[LOCALISATION SUPPRIMÉE]*\n${headerInfo}` });
            } else {
                await sock.sendMessage(myJid, { text: `🦅 *[MESSAGE SUPPRIMÉ]*\n${headerInfo}` });
            }
        }
        return;
    }

    // COMMANDES
    if (!isOwner) return;

    let text = content.conversation || content.extendedTextMessage?.text || '';
    if (content.imageMessage?.caption) text = content.imageMessage.caption;
    if (content.videoMessage?.caption) text = content.videoMessage.caption;

    if (!text || !text.startsWith(PREFIX)) return;

    const args = text.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    // 🥷 MODE FANTÔME
    if (commands.has(commandName)) {
        try {
            await sock.sendMessage(chatId, { delete: msg.key });
            console.log(`🥷 [GHOST] "!${commandName}" supprimée`);
        } catch (err) { }
    }

    await handleCommand(sock, msg, botState, {
        from: chatId, sender, senderNumber, isGroup, isFromMe, isOwner,
        commandName, args, text
    });
}

function handleReceipts(events, botState) {
    for (const receipt of events) {
        const targetId = receipt.key.id;
        for (const jid in botState.statusCache) {
            const item = botState.statusCache[jid].find(s => s.id === targetId);
            if (item) { item.seen = true; break; }
        }
    }
}

module.exports = { handleMessages, handleReceipts };
