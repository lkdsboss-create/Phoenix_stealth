const { downloadMediaMessage, normalizeMessageContent, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { handleCommands } = require('./commands');

function getRealMessage(message) {
    if (!message) return null;
    let normalized = normalizeMessageContent(message);
    if (!normalized) return null;
    while (
        normalized.ephemeralMessage || 
        normalized.documentWithCaptionMessage ||
        normalized.viewOnceMessage ||
        normalized.viewOnceMessageV2 ||
        normalized.viewOnceMessageV2Extension
    ) {
        if (normalized.ephemeralMessage) normalized = normalized.ephemeralMessage.message;
        else if (normalized.documentWithCaptionMessage) normalized = normalized.documentWithCaptionMessage.message;
        else if (normalized.viewOnceMessage) normalized = normalized.viewOnceMessage.message;
        else if (normalized.viewOnceMessageV2) normalized = normalized.viewOnceMessageV2.message;
        else if (normalized.viewOnceMessageV2Extension) normalized = normalized.viewOnceMessageV2Extension.message;
        if (!normalized) return null;
    }
    return normalized;
}

// 🚨 EXTRACTEUR CHIRURGICAL VIEW ONCE (Inspiré de whatsapp-service)
function extractAndNormalizeViewOnce(msg) {
    if (!msg || !msg.message) return { isViewOnce: false, cleanMsg: msg };
    
    let isVO = false;
    let innerMessage = msg.message;
    
    if (innerMessage.ephemeralMessage?.message) innerMessage = innerMessage.ephemeralMessage.message;
    if (innerMessage.documentWithCaptionMessage?.message) innerMessage = innerMessage.documentWithCaptionMessage.message;
    
    if (innerMessage.viewOnceMessageV2Extension?.message) {
        isVO = true;
        innerMessage = innerMessage.viewOnceMessageV2Extension.message;
    } else if (innerMessage.viewOnceMessageV2?.message) {
        isVO = true;
        innerMessage = innerMessage.viewOnceMessageV2.message;
    } else if (innerMessage.viewOnceMessage?.message) {
        isVO = true;
        innerMessage = innerMessage.viewOnceMessage.message;
    }
    
    if (innerMessage.imageMessage?.viewOnce || innerMessage.videoMessage?.viewOnce || innerMessage.audioMessage?.viewOnce) {
        isVO = true;
    }
    
    if (isVO) {
        // On désamorce le flag directement dans les métadonnées pour tromper Baileys
        for (const key in innerMessage) {
            if (innerMessage[key] && innerMessage[key].viewOnce) {
                innerMessage[key].viewOnce = false;
            }
        }
        // On retourne un objet message propre et téléchargeable
        return { isViewOnce: true, cleanMsg: { key: msg.key, message: innerMessage } };
    }
    
    return { isViewOnce: false, cleanMsg: msg };
}

async function handleMessages(sock, m, botState) {
    const msg = m.messages[0];
    if (!msg || !msg.message) return;

    const chatId = msg.key.remoteJid || '';
    const messageId = msg.key.id;
    const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;

    const DIRS = { antidelete: path.join(botState.LOCAL_DIR, 'Messages_Supprimes') };
    if (!fs.existsSync(DIRS.antidelete)) fs.mkdirSync(DIRS.antidelete, { recursive: true });

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

        const sContent = getRealMessage(msg.message);
        if (!sContent) return;

        const msgType = Object.keys(sContent)[0];
        const senderJid = jidNormalizedUser(rawSender);

        if (msgType === 'protocolMessage' && sContent.protocolMessage?.type === 0) {
            const deletedId = sContent.protocolMessage.key.id;
            if (botState.statusCache[senderJid]) {
                const savedStatusObj = botState.statusCache[senderJid].find(s => s.id === deletedId);
                
                if (savedStatusObj) {
                    const realDeletedContent = getRealMessage(savedStatusObj.msg.message);
                    if (!realDeletedContent) return;

                    const cleanNumber = senderJid.split('@')[0];
                    const savedName = botState.contactNames[senderJid];
                    const pushName = savedStatusObj.msg.pushName;
                    
                    let displayAuthor = cleanNumber;
                    if (savedName && pushName && savedName !== pushName) displayAuthor = `${savedName} (~${pushName})`;
                    else if (savedName) displayAuthor = savedName;
                    else if (pushName) displayAuthor = `${pushName} (${cleanNumber})`;

                    const headerInfo = `👤 *De :* ${displayAuthor}\n📢 *[STATUT SUPPRIMÉ]*`;
                    const isText = !!(realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text);
                    const isImage = !!realDeletedContent.imageMessage;
                    const isVideo = !!realDeletedContent.videoMessage;
                    const isAudio = !!(realDeletedContent.audioMessage || realDeletedContent.pttMessage);

                    if (isText) {
                        const textDeleted = realDeletedContent.conversation || realDeletedContent.extendedTextMessage?.text || '';
                        await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE STATUT]*\n${headerInfo}\n\n📝 *Texte :*\n${textDeleted}` });
                    } else if (isImage || isVideo || isAudio) {
                        try {
                            const buffer = await downloadMediaMessage(savedStatusObj.msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });
                            const mediaCaption = realDeletedContent.imageMessage?.caption || realDeletedContent.videoMessage?.caption || '';
                            
                            if (buffer) {
                                if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: `🦅 *[ANTI-DELETE STATUT]*\n${headerInfo}\n\n${mediaCaption}`.trim() });
                                else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: `🦅 *[ANTI-DELETE STATUT]*\n${headerInfo}\n\n${mediaCaption}`.trim() });
                                else if (isAudio) {
                                    const audioMeta = realDeletedContent.audioMessage || realDeletedContent.pttMessage;
                                    await sock.sendMessage(myJid, { text: `🦅 *[ANTI-DELETE STATUT VOCAL]*\n${headerInfo}` });
                                    await sock.sendMessage(myJid, { audio: buffer, mimetype: audioMeta?.mimetype || 'audio/ogg; codecs=opus', ptt: audioMeta?.ptt || false });
                                }
                            }
                        } catch (err) {
                            await sock.sendMessage(myJid, { text: `🦅 *[ERREUR MEDIA]*\n${headerInfo}\n⚠️ *Impossible de télécharger le statut supprimé.*` });
                        }
                    }
                    savedStatusObj.seen = true;
                    if (Object.keys(botState.activeIntervals).length === 0) try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
                }
            }
            return;
        }

        const isText = !!(sContent.extendedTextMessage?.text || sContent.conversation);
        const isImage = !!sContent.imageMessage;
        const isVideo = !!sContent.videoMessage;
        const isAudio = !!(sContent.audioMessage || sContent.pttMessage);

        if (!isText && !isImage && !isVideo && !isAudio) return;

        if (!botState.statusCache[senderJid]) botState.statusCache[senderJid] = [];
        const exists = botState.statusCache[senderJid].some(s => s.id === messageId);
        if (!exists) {
            botState.statusCache[senderJid].push({ 
                id: messageId,
                timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000), 
                senderName: msg.pushName || botState.contactNames[senderJid] || "Inconnu",
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

    // 🚨 ANTI-VIEW ONCE (Déballage et Aspiration)
    const viewOnceData = extractAndNormalizeViewOnce(msg);
    if (viewOnceData.isViewOnce && !msg.key.fromMe) {
        
        console.log("🦅 VUE UNIQUE INTERCEPTÉE :", {
            jid: msg.key.remoteJid,
            id: msg.key.id,
            types: Object.keys(viewOnceData.cleanMsg.message)
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
        
        const downloadMsg = viewOnceData.cleanMsg;
        const cleanContent = downloadMsg.message;
        
        const isImage = !!cleanContent.imageMessage;
        const isVideo = !!cleanContent.videoMessage;
        const isAudio = !!(cleanContent.audioMessage || cleanContent.pttMessage);

        try {
            const buffer = await downloadMediaMessage(downloadMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });
            const mediaCaption = cleanContent.imageMessage?.caption || cleanContent.videoMessage?.caption || '';

            if (buffer) {
                if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: `🦅 *[VUE UNIQUE]*\n${headerInfo}\n\n${mediaCaption}`.trim() });
                else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: `🦅 *[VUE UNIQUE]*\n${headerInfo}\n\n${mediaCaption}`.trim() });
                else if (isAudio) {
                    const audioMeta = cleanContent.audioMessage || cleanContent.pttMessage;
                    await sock.sendMessage(myJid, { text: `🦅 *[VUE UNIQUE VOCAL]*\n${headerInfo}` });
                    await sock.sendMessage(myJid, { audio: buffer, mimetype: audioMeta?.mimetype || 'audio/ogg; codecs=opus', ptt: audioMeta?.ptt || false });
                }
            }
        } catch (err) {
            console.error("❌ ERREUR VUE UNIQUE :", err);
            await sock.sendMessage(myJid, { text: `🦅 *[ERREUR VUE UNIQUE]*\n${headerInfo}\n⚠️ *Échec de l'extraction. Le format de WhatsApp a peut-être changé.*` });
        }
        if (Object.keys(botState.activeIntervals).length === 0) try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
    }

    // ANTI-DELETE UNIVERSEL (Messages classiques)
    if (msgType === 'protocolMessage' && content.protocolMessage?.type === 0) {
        const deletedId = content.protocolMessage.key.id;
        const savedMsg = botState.cacheMessages.get(deletedId);

        if (savedMsg && !savedMsg.key.fromMe) {
            const realDeletedContent = getRealMessage(savedMsg.message);
            if (!realDeletedContent) return;

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

module.exports = { handleMessages, handleReceipts, getRealMessage };
