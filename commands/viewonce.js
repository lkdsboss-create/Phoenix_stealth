const { downloadMediaMessage } = require('toxic-baileys');
const pino = require('pino');

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vo'],
    description: 'Récupère un View Once en réponse (envoie dans ton DM)',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;

        const quoted = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = quoted?.quotedMessage;
        const quotedId = quoted?.stanzaId;

        if (!quotedMsg || !quotedId) {
            await sock.sendMessage(myJid, {
                text: '❌ Réponds à un View Once avec !vv'
            });
            return;
        }

        const quotedKey = {
            remoteJid: ctx.from,
            fromMe: false,
            id: quotedId,
            participant: quoted?.participant
        };

        try {
            const buffer = await downloadMediaMessage(
                { key: quotedKey, message: quotedMsg },
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest }
            );

            if (!buffer) {
                await sock.sendMessage(myJid, { text: '❌ Média introuvable (déjà consulté).' });
                return;
            }

            const inner = quotedMsg.viewOnceMessageV2?.message
                || quotedMsg.viewOnceMessage?.message
                || quotedMsg.viewOnceMessageV2Extension?.message
                || quotedMsg;

            const type = Object.keys(inner)[0];

            if (type === 'imageMessage') {
                await sock.sendMessage(myJid, { image: buffer, caption: '🦅 Vue unique récupérée' });
            } else if (type === 'videoMessage') {
                await sock.sendMessage(myJid, { video: buffer, caption: '🦅 Vue unique récupérée' });
            } else if (type === 'audioMessage' || type === 'pttMessage') {
                const meta = inner.audioMessage || inner.pttMessage;
                await sock.sendMessage(myJid, { audio: buffer, mimetype: meta?.mimetype || 'audio/ogg; codecs=opus', ptt: true });
            } else {
                await sock.sendMessage(myJid, { text: `⚠️ Type non supporté : ${type}` });
            }

        } catch (e) {
            await sock.sendMessage(myJid, { text: `❌ Erreur : ${e.message}` });
        }
    }
};
