const { downloadMediaMessage } = require('toxic-baileys');
const pino = require('pino');

async function handleViewOnceReaction(sock, msg, botState, myJid) {
    const content = msg.message;
    if (!content?.reactionMessage) return false;

    const reaction = content.reactionMessage;
    const emoji = reaction.text;
    const targetKey = reaction.key;

    if (!targetKey || !targetKey.id) {
        console.log('⚠️ [REACTION] Pas de clé cible');
        return false;
    }

    if (!msg.key.fromMe) return false;
    if (!emoji || emoji.trim() === '') return false;

    console.log(`🦅 [REACTION] "${emoji}" sur ID: ${targetKey.id}`);
    console.log(`📦 [REACTION] Cache actuel: ${botState.cacheMessages.size} messages`);

    const targetMsg = botState.cacheMessages.get(targetKey.id);

    if (!targetMsg) {
        console.log('⚠️ [REACTION] Message PAS en cache');
        console.log(`   → ID cherché: ${targetKey.id}`);
        console.log(`   → 5 derniers IDs en cache:`, [...botState.cacheMessages.keys()].slice(-5));
        return false;
    }

    const m = targetMsg.message || {};
    const wrappers = Object.keys(m);
    console.log(`📋 [REACTION] Wrappers du message ciblé:`, wrappers);

    const isVO = m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension
              || m.imageMessage?.viewOnce || m.videoMessage?.viewOnce
              || m.audioMessage?.viewOnce;

    console.log(`📋 [REACTION] isViewOnce: ${!!isVO}`);

    if (!isVO) {
        console.log('⚠️ [REACTION] Ce n\'est pas un View Once');
        return false;
    }

    try {
        const buffer = await downloadMediaMessage(
            targetMsg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest }
        );

        if (!buffer) {
            console.log('⚠️ [REACTION] Média non téléchargeable (stub vide)');
            return false;
        }

        const inner = m.viewOnceMessageV2?.message
                   || m.viewOnceMessage?.message
                   || m.viewOnceMessageV2Extension?.message
                   || m;

        const type = Object.keys(inner)[0];
        const senderJid = targetKey.participant || targetKey.remoteJid || '';
        const senderName = (senderJid && botState.contactNames[senderJid]) || (senderJid.split('@')[0] || 'Inconnu');
        const chatName = targetKey.remoteJid?.endsWith('@g.us')
            ? (botState.contactNames[targetKey.remoteJid] || 'Groupe')
            : 'Privé';

        const caption = `🦅 *Vue unique récupérée*\n👤 De : ${senderName}\n💬 Dans : ${chatName}`;

        if (type === 'imageMessage') {
            await sock.sendMessage(myJid, { image: buffer, caption });
        } else if (type === 'videoMessage') {
            await sock.sendMessage(myJid, { video: buffer, caption });
        } else if (type === 'audioMessage' || type === 'pttMessage') {
            await sock.sendMessage(myJid, { text: caption });
            await sock.sendMessage(myJid, {
                audio: buffer,
                mimetype: inner.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
                ptt: true
            });
        }

        console.log('✅ [REACTION] Média envoyé dans ton DM');

        try {
            await sock.sendMessage(targetKey.remoteJid, {
                react: { text: '', key: targetKey }
            });
            console.log('🧹 [REACTION] Réaction retirée');
        } catch (e) {
            console.log(`⚠️ [REACTION] Retrait impossible: ${e.message}`);
        }

        return true;
    } catch (e) {
        console.error(`❌ [REACTION] Erreur download: ${e.message}`);
        return false;
    }
}

module.exports = { handleViewOnceReaction };
