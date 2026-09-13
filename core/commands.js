const { downloadMediaMessage, normalizeMessageContent, jidNormalizedUser } = require('@whiskeysockets/baileys');
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

function formatUptime(ms) {
    const s = Math.floor((ms / 1000) % 60), m = Math.floor((ms / (1000 * 60)) % 60);
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24), d = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${d}d ${h}h ${m}m ${s}s`;
}

async function handleCommands(sock, msg, content, chatId, myJid, botState) {
    const rawText = content.conversation || content.extendedTextMessage?.text || '';
    const text = rawText.trim().toLowerCase();
    if (!text) return;

    const commandsList = ['!menu', '!type', '!record', '!stop', '!tous', '!spam', '!statut', '!ping', '!runtime', '!clean', '!setnom'];
    if (commandsList.some(cmd => text === cmd || text.startsWith(cmd + ' '))) {
        try { await sock.sendMessage(chatId, { delete: msg.key }); } catch (err) {}
    } else {
        return; 
    }

    const resolveTargetInfo = async (cmdString) => {
        const arg = rawText.substring(cmdString.length).trim();
        let targetJid = chatId;
        let targetDisplay = "Inconnu";
        if (arg) targetJid = `${arg.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        
        targetJid = jidNormalizedUser(targetJid);
        
        if (botState.contactNames[targetJid]) targetDisplay = botState.contactNames[targetJid];
        else if (targetJid.endsWith('@g.us')) {
            try { targetDisplay = (await sock.groupMetadata(targetJid)).subject; } catch { targetDisplay = "Ce Groupe"; }
        } else targetDisplay = targetJid.split('@')[0];
        
        return { targetJid, targetDisplay };
    };

    if (text === '!ping') {
        const latence = Date.now() - (msg.messageTimestamp * 1000 || Date.now());
        await sock.sendMessage(myJid, { text: `🏓 *Pong !*\n⚡ Latence : \`${latence}ms\`\n🦅 *Phoenix Modulaire*` });
    }
    else if (text === '!runtime' || text === '!uptime') {
        await sock.sendMessage(myJid, { text: `⏱️ *Actif depuis :*\n\`${formatUptime(Date.now() - botState.START_TIME)}\`` });
    }
    else if (text === '!clean') {
        botState.cacheMessages.clear();
        await sock.sendMessage(myJid, { text: "🧹 *Cache mémoire vidé !*" });
    }
    else if (text === '!menu' || text === '!help') {
        const mText = `🦅 *PHOENIX CONTROL HUB v5.4.4* 🦅\n\n` +
            `⚡ *COMMANDES DE CONTROLE :*\n` +
            `• \`!statut\` ➜ Consulte la mémoire des statuts non lus.\n` +
            `• \`!statut [nom]\` ➜ Récupère les statuts d'un contact.\n` +
            `• \`!type [n°]\` ➜ Simule "Écrit..." en continu.\n` +
            `• \`!record [n°]\` ➜ Simule "Enregistre un vocal...".\n` +
            `• \`!stop [n°]\` ➜ Arrête toute simulation.\n` +
            `• \`!tous [texte]\` ➜ Mentionne tout le monde.\n` +
            `• \`!spam [n] [texte]\` ➜ Envoie [n] messages.\n` +
            `• \`!setnom [n°] [nom]\` ➜ Force un nom de contact.\n` +
            `• \`!ping\` ➜ Affiche la latence.\n` +
            `• \`!runtime\` ➜ Temps d'activité.\n` +
            `• \`!clean\` ➜ Libère la RAM.\n\n` +
            `📁 *Stockage :*\n\`${botState.LOCAL_DIR}\``;
        await sock.sendMessage(myJid, { text: mText });
    }
    else if (text.startsWith('!setnom ')) {
        const args = rawText.trim().split(' ');
        if (args.length >= 3) {
            let targetJid = `${args[1].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
            let assignedName = args.slice(2).join(' ');
            botState.contactNames[targetJid] = assignedName;
            await sock.sendMessage(myJid, { text: `✅ Ce numéro s'affichera comme "${assignedName}".` });
        }
    }
    else if (text.startsWith('!type')) {
        const { targetJid, targetDisplay } = await resolveTargetInfo('!type');
        if (botState.activeIntervals[targetJid]) clearInterval(botState.activeIntervals[targetJid]);
        try { 
            await sock.sendPresenceUpdate('available', targetJid);
            await sock.sendPresenceUpdate('composing', targetJid); 
        } catch(e){}
        botState.activeIntervals[targetJid] = setInterval(async () => {
            if (botState.currentSock !== sock) { clearInterval(botState.activeIntervals[targetJid]); delete botState.activeIntervals[targetJid]; return; }
            try { await sock.sendPresenceUpdate('composing', targetJid); } 
            catch (err) { clearInterval(botState.activeIntervals[targetJid]); delete botState.activeIntervals[targetJid]; }
        }, 8000);
        await sock.sendMessage(myJid, { text: `✍️ *Ghost Type activé pour :* ${targetDisplay}` });
    }
    else if (text.startsWith('!record')) {
        const { targetJid, targetDisplay } = await resolveTargetInfo('!record');
        if (botState.activeIntervals[targetJid]) clearInterval(botState.activeIntervals[targetJid]);
        try { 
            await sock.sendPresenceUpdate('available', targetJid);
            await sock.sendPresenceUpdate('recording', targetJid); 
        } catch(e){}
        botState.activeIntervals[targetJid] = setInterval(async () => {
            if (botState.currentSock !== sock) { clearInterval(botState.activeIntervals[targetJid]); delete botState.activeIntervals[targetJid]; return; }
            try { await sock.sendPresenceUpdate('recording', targetJid); } 
            catch (err) { clearInterval(botState.activeIntervals[targetJid]); delete botState.activeIntervals[targetJid]; }
        }, 8000);
        await sock.sendMessage(myJid, { text: `🎙️ *Ghost Record activé pour :* ${targetDisplay}` });
    }
    else if (text.startsWith('!stop')) {
        const { targetJid, targetDisplay } = await resolveTargetInfo('!stop');
        if (botState.activeIntervals[targetJid]) { clearInterval(botState.activeIntervals[targetJid]); delete botState.activeIntervals[targetJid]; }
        try { await sock.sendPresenceUpdate('paused', targetJid); } catch(e){}
        await sock.sendMessage(myJid, { text: `🛑 *Simulations arrêtées pour :* ${targetDisplay}` });
    }
    else if (text.startsWith('!tous') && chatId.endsWith('@g.us')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            const customMsg = rawText.substring(5).trim();
            
            let txt = `📢 *TAG GLOBAL* :\n`;
            if (customMsg) txt += `\n${customMsg}\n\n`;
            else txt += `\n`;
            
            metadata.participants.forEach((p, i) => { txt += `${i + 1}. @${p.id.split('@')[0]}\n`; });

            let options = {};
            const contextInfo = content.extendedTextMessage?.contextInfo;
            if (contextInfo && contextInfo.stanzaId) {
                options.quoted = {
                    key: {
                        remoteJid: chatId,
                        fromMe: jidNormalizedUser(contextInfo.participant) === myJid,
                        id: contextInfo.stanzaId,
                        participant: contextInfo.participant
                    },
                    message: contextInfo.quotedMessage
                };
            }
            await sock.sendMessage(chatId, { text: txt, mentions: metadata.participants.map(p => p.id) }, options);
        } catch (e) {}
    }
    else if (text.startsWith('!statut')) {
        const query = text.replace('!statut', '').trim();
        const unseenAuthors = Object.keys(botState.statusCache).filter(jid => {
            return botState.statusCache[jid].some(s => !s.seen);
        });

        if (!query) {
            if (unseenAuthors.length === 0) return await sock.sendMessage(myJid, { text: "📭 Aucun statut non lu en mémoire." });
            let msgList = `🦅 *STATUTS NON LUS (${unseenAuthors.length} contacts)* :\n\n`;
            
            unseenAuthors.forEach((jid, i) => {
                const countUnseen = botState.statusCache[jid].filter(s => !s.seen).length;
                const cleanNum = jid.split('@')[0];
                const displayName = botState.contactNames[jid] ? `${botState.contactNames[jid]} (${cleanNum})` : (botState.statusCache[jid][0]?.senderName || cleanNum);
                
                msgList += `${i + 1}. ${displayName} ➜ ${countUnseen} statut(s)\n`;
            });
            await sock.sendMessage(myJid, { text: msgList });
        } else {
            const queryLower = query.toLowerCase();
            let targetJid = null;
            let targetName = null;
            let unseenStatuses = [];

            for (const [jid, statuses] of Object.entries(botState.statusCache)) {
                const savedName = (botState.contactNames[jid] || "").toLowerCase();
                const cleanNum = jid.split('@')[0];
                const statusNames = statuses.map(s => (s.senderName || "").toLowerCase());

                if (
                    savedName.includes(queryLower) ||
                    cleanNum.includes(queryLower) ||
                    statusNames.some(name => name.includes(queryLower))
                ) {
                    targetJid = jid;
                    targetName = botState.contactNames[jid] ? `${botState.contactNames[jid]} (${cleanNum})` : (statuses[0]?.senderName || cleanNum);
                    unseenStatuses = statuses.filter(s => !s.seen);
                    break; 
                }
            }

            if (!targetJid) return await sock.sendMessage(myJid, { text: `⚠️ Aucun statut trouvé en mémoire pour : "${query}".` });
            if (unseenStatuses.length === 0) return await sock.sendMessage(myJid, { text: `🕵️‍♂️ Aucun statut non lu pour : ${targetName}` });
            
            await sock.sendMessage(myJid, { text: `🦅 *Envoi des statuts non lus de ${targetName}...*` });
            
            for (let sObj of unseenStatuses) {
                let sContent = getRealMessage(sObj.msg.message);
                
                // NOUVEAU LOG DE TRAÇAGE
                console.log("🦅 STATUT TROUVÉ :", {
                    jid: targetJid,
                    id: sObj.msg?.key?.id,
                    types: Object.keys(sObj.msg?.message || {}),
                    contentTypes: sContent ? Object.keys(sContent) : []
                });

                if (!sContent) continue;
                
                let isText = !!(sContent.extendedTextMessage?.text || sContent.conversation);
                let isImage = !!sContent.imageMessage;
                let isVideo = !!sContent.videoMessage;
                
                if (isText) {
                    await sock.sendMessage(myJid, { text: `📝 *Statut*:\n${sContent.extendedTextMessage?.text || sContent.conversation}` });
                } else if (isImage || isVideo) {
                    try {
                        const buffer = await downloadMediaMessage(sObj.msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                        if (isImage) await sock.sendMessage(myJid, { image: buffer });
                        else if (isVideo) await sock.sendMessage(myJid, { video: buffer });
                    } catch (e) {
                        // CAPTURE ET AFFICHAGE DE L'ERREUR DANS RENDER ET WHATSAPP
                        console.error("❌ ERREUR ENVOI STATUT :", {
                            nom: targetName,
                            jid: targetJid,
                            messageId: sObj.msg?.key?.id,
                            erreur: e?.message,
                            stack: e?.stack
                        });
                        
                        await sock.sendMessage(myJid, {
                            text: `❌ *Échec du statut de ${targetName}*\nErreur : ${e?.message || 'Expiration du média'}`
                        });
                    }
                }
                sObj.seen = true;
                await new Promise(res => setTimeout(res, 800)); 
            }
            
            const stillUnseen = botState.statusCache[targetJid].filter(s => !s.seen);
            if (stillUnseen.length === 0) {
                delete botState.statusCache[targetJid];
                await sock.sendMessage(myJid, { text: `✅ *Statuts marqués comme vus et effacés de la mémoire.*` });
            }
        }
    }
    
    if (Object.keys(botState.activeIntervals).length === 0) {
        try { await sock.sendPresenceUpdate('unavailable'); } catch(e){}
    }
}

module.exports = { handleCommands };
                            
