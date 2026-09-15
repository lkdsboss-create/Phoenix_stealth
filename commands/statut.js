const { downloadMediaMessage, normalizeMessageContent } = require('@whiskeysockets/baileys');
const pino = require('pino');

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

function buildCaption(header, caption) {
    const clean = (caption || '').trim();
    if (clean) return `${header}\n\n📝 *Légende :*\n${clean}`;
    return header;
}

module.exports = {
    name: 'statut',
    aliases: ['status'],
    description: 'Statuts non lus',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        const query = ctx.args.join(' ').trim().toLowerCase();
        const unseenAuthors = Object.keys(botState.statusCache).filter(jid => {
            return botState.statusCache[jid].some(s => !s.seen);
        });

        // LISTE
        if (!query) {
            if (unseenAuthors.length === 0) {
                await sock.sendMessage(myJid, { text: "📭 Aucun statut non lu en mémoire." });
                return;
            }
            let msgList = `🦅 *STATUTS NON LUS (${unseenAuthors.length} contacts)* :\n\n`;
            unseenAuthors.forEach((jid, i) => {
                const countUnseen = botState.statusCache[jid].filter(s => !s.seen).length;
                const cleanNum = jid.split('@')[0];
                const displayName = botState.contactNames[jid] ? `${botState.contactNames[jid]} (${cleanNum})` : (botState.statusCache[jid][0]?.senderName || cleanNum);
                msgList += `${i + 1}. ${displayName} ➜ ${countUnseen} statut(s)\n`;
            });
            msgList += `\n💡 Tape \`!statut <nom>\` pour voir les statuts d'un contact.`;
            await sock.sendMessage(myJid, { text: msgList });
            return;
        }

        // RECHERCHE PAR NOM/NUMÉRO (partielle)
        let targetJid = null;
        let targetName = null;
        let unseenStatuses = [];

        for (const [jid, statuses] of Object.entries(botState.statusCache)) {
            const savedName = (botState.contactNames[jid] || "").toLowerCase();
            const cleanNum = jid.split('@')[0];
            const statusNames = statuses.map(s => (s.senderName || "").toLowerCase());

            // Recherche partielle : "Blue" trouve "Blue Bird ✨"
            if (
                savedName.includes(query) ||
                cleanNum.includes(query) ||
                statusNames.some(name => name.includes(query))
            ) {
                targetJid = jid;
                targetName = botState.contactNames[jid] ? `${botState.contactNames[jid]} (${cleanNum})` : (statuses[0]?.senderName || cleanNum);
                unseenStatuses = statuses.filter(s => !s.seen);
                break;
            }
        }

        if (!targetJid) {
            await sock.sendMessage(myJid, { text: `⚠️ Aucun statut trouvé pour : "${query}".` });
            return;
        }
        if (unseenStatuses.length === 0) {
            await sock.sendMessage(myJid, { text: `🕵️‍♂️ Aucun statut non lu pour : ${targetName}` });
            return;
        }

        await sock.sendMessage(myJid, { text: `🦅 *Envoi des statuts de ${targetName} (${unseenStatuses.length})...*` });

        for (let sObj of unseenStatuses) {
            let sContent = getRealMessage(sObj.msg.message);
            if (!sContent) {
                sObj.seen = true;
                await new Promise(res => setTimeout(res, 800));
                continue;
            }

            const isText = !!(sContent.extendedTextMessage?.text || sContent.conversation);
            const isImage = !!sContent.imageMessage;
            const isVideo = !!sContent.videoMessage;
            const isAudio = !!(sContent.audioMessage || sContent.pttMessage);
            const isReaction = !!sContent.reactionMessage;
            const isNotification = !!sContent.statusNotificationMessage;
            const isProtocol = !!sContent.protocolMessage;

            if (isText) {
                const txt = sContent.extendedTextMessage?.text || sContent.conversation;
                await sock.sendMessage(myJid, { text: `📝 *Statut :*\n${txt}` });
            } else if (isImage || isVideo || isAudio) {
                try {
                    const buffer = await downloadMediaMessage(sObj.msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });

                    // ✅ CAPTURE DE LA LÉGENDE
                    const mediaCaption = sContent.imageMessage?.caption
                                      || sContent.videoMessage?.caption
                                      || sObj.caption
                                      || '';

                    const header = `🦅 *Statut de ${targetName}*`;
                    const finalCaption = buildCaption(header, mediaCaption);

                    if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: finalCaption });
                    else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: finalCaption });
                    else if (isAudio) {
                        await sock.sendMessage(myJid, { text: header });
                        await sock.sendMessage(myJid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    }
                } catch (e) {
                    await sock.sendMessage(myJid, { text: `❌ Échec du statut de ${targetName}` });
                }
            } else if (isReaction) {
                await sock.sendMessage(myJid, { text: `👀 *Réaction* : ${sContent.reactionMessage.text || '?'}` });
            } else if (isNotification) {
                await sock.sendMessage(myJid, { text: `⚙️ *Notification Système*` });
            } else if (isProtocol) {
                await sock.sendMessage(myJid, { text: `🗑️ *Action Système*` });
            } else {
                await sock.sendMessage(myJid, { text: `⚠️ *Format brut* : \`${Object.keys(sContent).join(', ')}\`` });
            }

            sObj.seen = true;
            await new Promise(res => setTimeout(res, 800));
        }

        const stillUnseen = botState.statusCache[targetJid].filter(s => !s.seen);
        if (stillUnseen.length === 0) {
            delete botState.statusCache[targetJid];
            await sock.sendMessage(myJid, { text: `✅ *Tous les statuts traités.*` });
        }
    }
};
