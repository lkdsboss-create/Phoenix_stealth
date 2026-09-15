const { downloadContentFromMessage, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

// ==========================================
// WRAPPERS ET TYPES
// ==========================================
const VO_WRAPPERS = ['viewOnceMessageV2Extension', 'viewOnceMessageV2', 'viewOnceMessage'];
const TRANSPORT = [
    'ephemeralMessage',
    'documentWithCaptionMessage',
    'deviceSentMessage',
    'editedMessage',
    'futureProofMessage'
];

/**
 * Déplie récursivement un message en traversant les wrappers.
 * Inspiré de deepUnwrap() de Toxic-MD.
 */
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

/**
 * Extrait le média (image/vidéo/audio) d'un message déplié.
 */
function pickMedia(inner) {
    if (!inner) return null;
    if (inner.imageMessage) return { type: 'image', msg: inner.imageMessage };
    if (inner.videoMessage) return { type: 'video', msg: inner.videoMessage };
    if (inner.audioMessage) return { type: 'audio', msg: inner.audioMessage };
    if (inner.pttMessage) return { type: 'audio', msg: inner.pttMessage };
    return null;
}

/**
 * Vérifie si un message est un View Once.
 * Teste les wrappers ET le flag inline.
 */
function isViewOnce(message) {
    if (!message) return false;
    
    // Vérifie les wrappers
    for (const w of VO_WRAPPERS) {
        if (message[w]?.message) return true;
    }
    
    // Vérifie le flag inline après dépliage
    const inner = deepUnwrap(message);
    if (inner) {
        if (inner.imageMessage?.viewOnce) return true;
        if (inner.videoMessage?.viewOnce) return true;
        if (inner.audioMessage?.viewOnce) return true;
        if (inner.pttMessage?.viewOnce) return true;
    }
    return false;
}

/**
 * Tente de télécharger le média avec plusieurs stratégies successives.
 * La clé : utiliser downloadContentFromMessage en priorité.
 */
async function grab(sock, mediaMsg, mediaType) {
    // ==========================================
    // Stratégie 1 : downloadContentFromMessage (stream)
    // La méthode la plus fiable pour les View Once
    // ==========================================
    try {
        const dlType = mediaType === 'audio' ? 'audio'
                     : mediaType === 'video' ? 'video'
                     : 'image';
        
        console.log(`🔄 Tentative via downloadContentFromMessage (${dlType})...`);
        const stream = await downloadContentFromMessage(mediaMsg, dlType);
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const buf = Buffer.concat(chunks);
        if (buf && buf.length > 0) {
            console.log(`✅ downloadContentFromMessage OK (${(buf.length / 1024).toFixed(1)} KB)`);
            return buf;
        }
    } catch (e) {
        console.log(`⚠️ downloadContentFromMessage échoué: ${e.message}`);
    }

    // ==========================================
    // Stratégie 2 : downloadMediaMessage classique
    // ==========================================
    try {
        console.log('🔄 Tentative via downloadMediaMessage...');
        const buf = await downloadMediaMessage(
            { message: { [`${mediaType}Message`]: mediaMsg } },
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );
        if (buf && buf.length > 0) {
            console.log(`✅ downloadMediaMessage OK (${(buf.length / 1024).toFixed(1)} KB)`);
            return buf;
        }
    } catch (e) {
        console.log(`⚠️ downloadMediaMessage échoué: ${e.message}`);
    }

    return null;
}

// ==========================================
// COMMANDE
// ==========================================
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

        console.log('📦 [VIEWONCE] Wrappers du message cité:', Object.keys(quotedMsg).join(', '));

        // Vérifie si c'est un View Once
        if (!isViewOnce(quotedMsg)) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Ce message n\'est pas un View Once.'
            }, { quoted: msg });
            return;
        }

        // Déplie le message
        const inner = deepUnwrap(quotedMsg);
        const media = pickMedia(inner);

        if (!media) {
            await sock.sendMessage(ctx.from, {
                text: '⚠️ View Once détecté mais aucun média extractible.\n' +
                      'WhatsApp a probablement envoyé un stub vide.'
            }, { quoted: msg });
            return;
        }

        console.log(`📦 [VIEWONCE] Type: ${media.type}`);
        console.log(`📦 [VIEWONCE] viewOnce flag: ${media.msg.viewOnce}`);

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

            // Prépare le contenu à renvoyer
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
