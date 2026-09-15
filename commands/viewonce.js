const { downloadContentFromMessage, downloadMediaMessage } = require('toxic-baileys');
const pino = require('pino');

const VO_WRAPPERS = ['viewOnceMessageV2Extension', 'viewOnceMessageV2', 'viewOnceMessage'];
const TRANSPORT = [
    'ephemeralMessage',
    'documentWithCaptionMessage',
    'deviceSentMessage',
    'editedMessage',
    'futureProofMessage'
];

function deepUnwrap(msg) {
    if (!msg) return null;
    const ALL = [...VO_WRAPPERS, ...TRANSPORT];
    let cur = msg;
    for (let i = 0; i < 15; i++) {
        const k = ALL.find(w => cur[w]?.message);
        if (!k) break;
        cur = cur[k].message;
    }
    return cur;
}

function pickMedia(inner) {
    if (!inner) return null;
    if (inner.imageMessage) return { type: 'image', msg: inner.imageMessage };
    if (inner.videoMessage) return { type: 'video', msg: inner.videoMessage };
    if (inner.audioMessage) return { type: 'audio', msg: inner.audioMessage };
    if (inner.pttMessage) return { type: 'audio', msg: inner.pttMessage };
    for (const key of Object.keys(inner)) {
        if (inner[key] && typeof inner[key] === 'object') {
            if (inner[key].url || inner[key].directPath) {
                return { type: key.replace('Message', ''), msg: inner[key] };
            }
        }
    }
    return null;
}

function isViewOnce(message) {
    if (!message) return false;
    for (const w of VO_WRAPPERS) {
        if (message[w]?.message) return true;
    }
    const inner = deepUnwrap(message);
    if (inner) {
        if (inner.imageMessage?.viewOnce) return true;
        if (inner.videoMessage?.viewOnce) return true;
        if (inner.audioMessage?.viewOnce) return true;
        if (inner.pttMessage?.viewOnce) return true;
    }
    return false;
}

async function grab(sock, mediaMsg, mediaType) {
    try {
        console.log(`🔄 [1/3] downloadContentFromMessage (${mediaType})...`);
        const dlType = mediaType === 'audio' ? 'audio'
                     : mediaType === 'video' ? 'video'
                     : 'image';
        const stream = await downloadContentFromMessage(mediaMsg, dlType);
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const buf = Buffer.concat(chunks);
        if (buf && buf.length > 0) {
            console.log(`✅ [1/3] OK (${(buf.length / 1024).toFixed(1)} KB)`);
            return buf;
        }
    } catch (e) {
        console.log(`⚠️ [1/3] Échec: ${e.message}`);
    }

    try {
        console.log('🔄 [2/3] downloadMediaMessage direct...');
        const buf = await downloadMediaMessage(
            { message: { [`${mediaType}Message`]: mediaMsg } },
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );
        if (buf && buf.length > 0) {
            console.log(`✅ [2/3] OK (${(buf.length / 1024).toFixed(1)} KB)`);
            return buf;
        }
    } catch (e) {
        console.log(`⚠️ [2/3] Échec: ${e.message}`);
    }

    try {
        console.log('🔄 [3/3] downloadMediaMessage avec message factice...');
        const fakeMsg = {
            key: { remoteJid: 'status@broadcast', fromMe: false, id: 'x' },
            message: { [`${mediaType}Message`]: mediaMsg }
        };
        const buf = await downloadMediaMessage(
            fakeMsg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );
        if (buf && buf.length > 0) {
            console.log(`✅ [3/3] OK (${(buf.length / 1024).toFixed(1)} KB)`);
            return buf;
        }
    } catch (e) {
        console.log(`⚠️ [3/3] Échec: ${e.message}`);
    }

    return null;
}

module.exports = {
    name: 'viewonce',
    aliases: ['vv', 'vo', 'capture'],
    description: 'Récupère un média View Once (en réponse)',
    async execute(sock, msg, botState, ctx) {
        console.log('👁️ [VIEWONCE] Commande reçue');

        const quoted = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = quoted?.quotedMessage;
        const quotedId = quoted?.stanzaId;

        if (!quotedMsg || !quotedId) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Réponds à un View Once avec !vv pour le capturer.'
            }, { quoted: msg });
            return;
        }

        console.log('📦 [VIEWONCE] Clés:', Object.keys(quotedMsg).join(', '));

        if (!isViewOnce(quotedMsg)) {
            const inner = deepUnwrap(quotedMsg);
            const media = pickMedia(inner);
            if (!media) {
                await sock.sendMessage(ctx.from, {
                    text: '❌ Ce message n\'est pas un View Once.'
                }, { quoted: msg });
                return;
            }
            console.log('⚠️ [VIEWONCE] Pas de flag viewOnce mais média détecté → tentative');
        }

        const inner = deepUnwrap(quotedMsg);
        const media = pickMedia(inner);

        if (!media) {
            await sock.sendMessage(ctx.from, {
                text: '⚠️ View Once détecté mais aucun média extractible.'
            }, { quoted: msg });
            return;
        }

        console.log(`📦 [VIEWONCE] Type: ${media.type}`);

        try {
            const buffer = await grab(sock, media.msg, media.type);

            if (!buffer || buffer.length === 0) {
                await sock.sendMessage(ctx.from, {
                    text: '❌ Impossible de récupérer le média.\n\n' +
                          'Toutes les stratégies ont échoué.\n' +
                          'WhatsApp bloque probablement ce View Once (stub vide).'
                }, { quoted: msg });
                return;
            }

            const content = { [media.type]: buffer };
            if (media.type === 'audio') {
                content.mimetype = media.msg.mimetype || 'audio/ogg; codecs=opus';
                content.ptt = media.msg.ptt !== false;
            } else {
                content.caption = '✅ View Once capturé';
            }

            await sock.sendMessage(ctx.from, content, { quoted: msg });
            console.log('✅ [VIEWONCE] Envoyé');

        } catch (e) {
            console.error('❌ [VIEWONCE] Erreur:', e.message);
            await sock.sendMessage(ctx.from, {
                text: `❌ Erreur: ${e.message}`
            }, { quoted: msg });
        }
    }
};
