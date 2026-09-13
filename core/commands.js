const { downloadMediaMessage, normalizeMessageContent } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Fonction intégrée directement ici pour casser la dépendance circulaire
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
        return; // Ce n'est pas une commande
    }

    const resolveTargetInfo = async (cmdString) => {
        const arg = rawText.substring(cmdString.length).trim();
        let targetJid = chatId;
        let targetDisplay = "Inconnu";
        if (arg) targetJid = `${arg.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        
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
    else if (text === '!tous' && chatId.endsWith('@g.us')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            let txt = `📢 *TAG GLOBAL* :\n\n`;
            metadata.participants.forEach((p, i) => { txt += `${i + 1}. @${p.id.split('@')[0]}\n`; });
            await sock.sendMessage(chatId, { text: txt, mentions: metadata.participants.map(p => p.id) });
        } catch (e) {}
    }
    else if (text.startsWith('!statut')) {
        const query = text.replace('!statut', '').trim();
        if (!query) {
            const authors = Object.keys(botState.statusCache);
            if (authors.length === 0) return await sock.sendMessage(myJid, { text: "📭 Aucun statut en cache." });
            let msgList = "🦅 *STATUTS EN CACHE* :\n\n";
            authors.slice(-10).forEach((jid, i) => {
                msgList += `${i + 1}. ${botState.contactNames[jid] || "Inconnu"} ➜ ${botState.statusCache[jid].length} statut(s)\n`;
            });
            await sock.sendMessage(myJid, { text: msgList });
        } else {
            const matches = Object.entries(botState.contactNames).filter(([jid, name]) => name.toLowerCase().includes(query.toLowerCase()) || jid.includes(query)).map(([jid, name]) => ({ jid, name }));
            if (matches.length === 0) return await sock.sendMessage(myJid, { text: `⚠️ Contact introuvable.` });
            
            const targetJid = matches[0].jid;
            const targetName = matches[0].name;
            const userStatuses = botState.statusCache[targetJid];

            if (!userStatuses || userStatuses.length === 0) return await sock.sendMessage(myJid, { text: `🕵️‍♂️ Aucun statut pour : ${targetName}` });
            
            await sock.sendMessage(myJid, { text: `🦅 *Statuts de ${targetName}...*` });
            for (let sObj of userStatuses) {
                let sContent = getRealMessage(sObj.msg.message);
                if (!sContent) continue;
                let isText = !!(sContent.extendedTextMessage?.text || sContent.conversation);
                let isImage = !!sContent.imageMessage;
                let isVideo = !!sContent.videoMessage;
                
                if (isText) await sock.sendMessage(myJid, { text: `📝 *Statut*:\n${sContent.extendedTextMessage?.text || sContent.conversation}` });
                else if (isImage || isVideo) {
                    try {
                        const buffer = await downloadMediaMessage(sObj.msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                        if (isImage) await sock.sendMessage(myJid, { image: buffer });
                        else if (isVideo) await sock.sendMessage(myJid, { video: buffer });
                    } catch (e) {}
                }
                await new Promise(res => setTimeout(res, 800)); 
            }
            
            delete botState.statusCache[targetJid];
            await sock.sendMessage(myJid, { text: `✅ *Statuts marqués comme vus et effacés de la mémoire.*` });
        }
    }
    
    if (Object.keys(botState.activeIntervals).length === 0) {
        try { await sock.sendPresenceUpdate('unavailable'); } catch(e){}
    }
}

module.exports = { handleCommands };
