const { downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { handleCommands } = require('./commands');

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

async function handleMessages(sock, m, botState) {
    let msg = m.messages[0];
    if (!msg || !msg.message) return;

    msg = unwrapMessageInPlace(msg);
    const content = msg.message;
    const msgType = Object.keys(content)[0];
    
    const chatId = msg.key.remoteJid || '';
    const messageId = msg.key.id;
    const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;

    if (!msg.key.fromMe && msg.pushName) {
        const rawJid = msg.key.participant || chatId;
        const contactJid = jidNormalizedUser(rawJid);
        
        if (!botState.contactNames[contactJid]) {
            botState.contactNames[contactJid] = msg.pushName;
            if (!botState.isSavingContacts) {
                botState.isSavingContacts = true;
                fsPromises.writeFile(botState.NAMES_FILE, JSON.stringify(botState.contactNames, null, 2))
                    .catch(()=>{})
                    .finally(() => botState.isSavingContacts = false);
            }
        }
    }

    if (chatId === 'status@broadcast') {
        const rawSender = msg.key.participant;
        if (!rawSender) return;
        const senderJid = jidNormalizedUser(rawSender);

        if (msgType === 'protocolMessage' && content.protocolMessage?.type === 0) {
            const deletedId = content.protocolMessage.key.id;
            if (botState.statusCache[senderJid]) {
                const savedStatusObj = botState.statusCache[senderJid].find(s => s.id === deletedId);
                
                if (savedStatusObj) {
                    const cleanNumber = senderJid.split('@')[0];
                    const savedName = botState.contactNames[senderJid];
                    const pushName = savedStatusObj.senderName;
                    
                    let displayAuthor = cleanNumber;
                    if (savedName && pushName && savedName !== pushName) displayAuthor = `${savedName} (~${pushName})`;
                    else if (savedName) displayAuthor = savedName;
                    else if (pushName) displayAuthor = `${pushName} (${cleanNumber})`;

                    const headerInfo = `👤 *De :* ${displayAuthor}\n📢 *[STATUT SUPPRIMÉ]*`;

                    if (savedStatusObj.type === 'text') {
                        await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE STATUT]*\n${headerInfo}\n\n📝 *Texte :*\n${savedStatusObj.text}` });
                    } else if (savedStatusObj.localPath && fs.existsSync(savedStatusObj.localPath)) {
                        const buffer = fs.readFileSync(savedStatusObj.localPath);
                        if (savedStatusObj.type === 'image') await sock.sendMessage(myJid, { image: buffer, caption: `🦅 *[ANTI-DELETE STATUT]*\n${headerInfo}\n\n${savedStatusObj.caption}`.trim() });
                        else if (savedStatusObj.type === 'video') await sock.sendMessage(myJid, { video: buffer, caption: `🦅 *[ANTI-DELETE STATUT]*\n${headerInfo}\n\n${savedStatusObj.caption}`.trim() });
                        else if (savedStatusObj.type === 'audio') {
                            await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE STATUT VOCAL]*\n${headerInfo}` });
                            await sock.sendMessage(myJid, { audio: buffer, mimetype: savedStatusObj.mimetype || 'audio/ogg; codecs=opus', ptt: savedStatusObj.ptt });
                        }
                    } else {
                        await sock.sendMessage(myJid, { text: `🦅 *[ERREUR]*\n${headerInfo}\n⚠️ *Fichier média introuvable sur le disque local.*` });
                    }
                    
                    savedStatusObj.seen = true;
                    if (Object.keys(botState.activeIntervals).length === 0) try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
                }
            }
            return;
        }

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
                } catch (e) {}
            }

            const statusObj = { 
                id: messageId,
                timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000), 
                senderName: msg.pushName || botState.contactNames[senderJid] || "Inconnu",
                type: mediaType,
                localPath: localPath,
                text: content.extendedTextMessage?.text || content.conversation || '',
                caption: content.imageMessage?.caption || content.videoMessage?.caption || '',
                mimetype: content.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
                ptt: content.audioMessage?.ptt || content.pttMessage?.ptt || false,
                seen: false 
            };

            botState.statusCache[senderJid].push(statusObj);

            if (!botState.isSavingStatus) {
                botState.isSavingStatus = true;
                fsPromises.writeFile(botState.STATUS_JSON, JSON.stringify(botState.statusCache, null, 2))
                    .catch(()=>{})
                    .finally(() => botState.isSavingStatus = false);
            }
        }
        return;
    }

    if (messageId) {
        if (botState.cacheMessages.size >= 3000) botState.cacheMessages.delete(botState.cacheMessages.keys().next().value);
        botState.cacheMessages.set(messageId, msg);
    }

    // 🚨 LOG DE DIAGNOSTIC VUE UNIQUE
    if (msg.wasViewOnce && !msg.key.fromMe) {
        console.log("🔎 VIEW ONCE DEBUG", {
            id: msg.key.id,
            remoteJid: msg.key.remoteJid,
            messageKeys: Object.keys(m.messages[0]?.message || {}),
            cleanKeys: Object.keys(msg.message || {}),
            isViewOnce: msg.wasViewOnce
        });

        const targetChatId = msg.key.remoteJid;
        const rawSender = msg.key.participant || targetChatId;
        const senderJid = jidNormalizedUser(rawSender);
        const cleanNumber = senderJid.split('@')[0];
        
        const savedName = botState.contactNames[senderJid];
        const pushName = msg.pushName;
        
        let displayAuthor = cleanNumber;
        if (savedName && pushName && savedName !== pushName) displayAuthor = `${savedName} (~${pushName})`;
        else if (savedName) displayAuthor = savedName;
        else if (pushName) displayAuthor = `${pushName} (${cleanNumber})`;

        let groupContext = "";
        if (targetChatId.endsWith('@g.us')) {
            let groupName = "Inconnu";
            if (botState.contactNames[targetChatId]) groupName = botState.contactNames[targetChatId];
            groupContext = `\n👥 *Groupe :* ${groupName}`;
        }

        const headerInfo = `👤 *De :* ${displayAuthor}${groupContext}`;
        
        const isImage = !!content.imageMessage;
        const isVideo = !!content.videoMessage;
        const isAudio = !!(content.audioMessage || content.pttMessage);

        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });
            const mediaCaption = content.imageMessage?.caption || content.videoMessage?.caption || '';

            if (buffer) {
                if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: `🦅 *[VUE UNIQUE]*\n${headerInfo}\n\n${mediaCaption}`.trim() });
                else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: `🦅 *[VUE UNIQUE]*\n${headerInfo}\n\n${mediaCaption}`.trim() });
                else if (isAudio) {
                    const audioMeta = content.audioMessage || content.pttMessage;
                    await sock.sendMessage(myJid, { text: `🦅 *[VUE UNIQUE VOCAL]*\n${headerInfo}` });
                    await sock.sendMessage(myJid, { audio: buffer, mimetype: audioMeta?.mimetype || 'audio/ogg; codecs=opus', ptt: audioMeta?.ptt || false });
                }
            }
        } catch (err) {
            console.error("❌ ERREUR VIEW ONCE COMPLETE :", {
                message: err?.message,
                stack: err?.stack,
                id: msg.key.id,
                keys: Object.keys(m.messages[0]?.message || {}),
                cleanKeys: Object.keys(msg.message || {})
            });

            try {
                await sock.sendMessage(myJid, {
                    text: `🦅 *[ERREUR VUE UNIQUE]*\n⚠️ ${err?.message || "Erreur inconnue"}`
                });
            } catch {}
        }
        if (Object.keys(botState.activeIntervals).length === 0) try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
    }

    // ANTI-DELETE CLASSIQUE
    if (msgType === 'protocolMessage' && content.protocolMessage?.type === 0) {
        const deletedId = content.protocolMessage.key.id;
        const savedMsg = botState.cacheMessages.get(deletedId);

        if (savedMsg && !savedMsg.key.fromMe) {
            const realDeletedContent = savedMsg.message;
            const targetChatId = savedMsg.key.remoteJid;
            const rawSender = savedMsg.key.participant || targetChatId;
            const senderJid = jidNormalizedUser(rawSender);
            const cleanNumber = senderJid.split('@')[0];
            
            const savedName = botState.contactNames[senderJid];
            const pushName = savedMsg.pushName;
            
            let displayAuthor = cleanNumber;
            if (savedName && pushName && savedName !== pushName) displayAuthor = `${savedName} (~${pushName})`;
            else if (savedName) displayAuthor = savedName;
            else if (pushName) displayAuthor = `${pushName} (${cleanNumber})`;

            let groupContext = "";
            if (targetChatId.endsWith('@g.us')) {
                let groupName = "Inconnu";
                if (botState.contactNames[targetChatId]) groupName = botState.contactNames[targetChatId];
                groupContext = `\n👥 *Groupe :* ${groupName}`;
            }

            const headerInfo = `👤 *De :* ${displayAuthor}${groupContext}`;

            const isText = !!(realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text);
            const isImage = !!realDeletedContent.imageMessage;
            const isVideo = !!realDeletedContent.videoMessage;
            const isAudio = !!realDeletedContent.audioMessage;
            const isSticker = !!realDeletedContent.stickerMessage;
            const isDocument = !!realDeletedContent.documentMessage;
            const isContact = !!realDeletedContent.contactMessage;
            const isLocation = !!realDeletedContent.locationMessage;

            if (isText) {
                const textDeleted = realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text || '';
                await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE TEXTE]*\n${headerInfo}\n\n📝 *Message :*\n${textDeleted}` });
            } else if (isImage || isVideo || isAudio || isSticker || isDocument) {
                try {
                    const buffer = await downloadMediaMessage(savedMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });
                    const mediaCaption = realDeletedContent.imageMessage?.caption || realDeletedContent.videoMessage?.caption || '';

                    if (buffer) {
                        if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: `🦅 *[ANTI-DELETE PHOTO]*\n${headerInfo}\n\n${mediaCaption}`.trim() });
                        else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: `🦅 *[ANTI-DELETE VIDÉO]*\n${headerInfo}\n\n${mediaCaption}`.trim() });
                        else if (isAudio) {
                            const audioMeta = realDeletedContent.audioMessage || realDeletedContent.pttMessage;
                            await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE VOCAL]*\n${headerInfo}` });
                            await sock.sendMessage(myJid, { audio: buffer, mimetype: audioMeta?.mimetype || 'audio/ogg; codecs=opus', ptt: audioMeta?.ptt || false });
                        } else if (isSticker) {
                            await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE STICKER]*\n${headerInfo}` });
                            await sock.sendMessage(myJid, { sticker: buffer });
                        } else if (isDocument) {
                            const docName = realDeletedContent.documentMessage.fileName || 'Fichier';
                            const docMime = realDeletedContent.documentMessage.mimetype || 'application/octet-stream';
                            await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE DOCUMENT]*\n${headerInfo}\n📎 *Nom :* ${docName}\n\n${mediaCaption}`.trim() });
                            await sock.sendMessage(myJid, { document: buffer, mimetype: docMime, fileName: docName });
                        }
                    }
                } catch (err) {
                    await sock.sendMessage(myJid, { text: `🦅 *[ERREUR MEDIA]*\n${headerInfo}\n⚠️ *Impossible de télécharger le média supprimé.*` });
                }
            } else if (isContact) {
                const contactName = realDeletedContent.contactMessage.displayName || 'Contact';
                await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE CONTACT]*\n${headerInfo}\n📇 *Contact partagé :* ${contactName}` });
            } else if (isLocation) {
                await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE LOCALISATION]*\n${headerInfo}\n📍 *Position partagée*` });
            } else {
                await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE]*\n${headerInfo}\n⚠️ *Format non supporté supprimé.*` });
            }

            if (Object.keys(botState.activeIntervals).length === 0) try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
        }
        return;
    }

    if (msg.key.fromMe) {
        await handleCommands(sock, msg, content, chatId, myJid, botState);
    }
}

function handleReceipts(events, botState) {
    for (const receipt of events) {
        const targetId = receipt.key.id;
        for (const jid in botState.statusCache) {
            const item = botState.statusCache[jid].find(s => s.id === targetId);
            if (item) {
                item.seen = true;
                break;
            }
        }
    }
}

module.exports = { handleMessages, handleReceipts };
            
