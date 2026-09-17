const { downloadMediaMessage } = require('toxic-baileys');
const pino = require('pino');
const { deepUnwrap, stripViewOnceFlags, getMediaType, isViewOnceStub } = require('./viewOnceHelper');

// ==========================================
// ANTI-SPAM : éviter les boucles
// ==========================================
const processingStubs = new Map(); // clé: messageId → timestamp
const PROCESSING_TTL = 60000; // 1 minute

function isAlreadyProcessing(id) {
    const t = processingStubs.get(id);
    if (!t) return false;
    if (Date.now() - t > PROCESSING_TTL) {
        processingStubs.delete(id);
        return false;
    }
    return true;
}

function markProcessing(id) {
    processingStubs.set(id, Date.now());
}

setInterval(() => {
    const now = Date.now();
    for (const [id, t] of processingStubs.entries()) {
        if (now - t > PROCESSING_TTL) processingStubs.delete(id);
    }
}, 30000);

// ==========================================
// FONCTION PRINCIPALE
// ==========================================
/**
 * Traite un View Once automatiquement.
 *
 * @param {object} sock - Socket Baileys
 * @param {object} msg - Message reçu (peut être un stub OU un message complet)
 * @param {object} botState - State du bot
 * @param {string} myJid - Ton DM
 * @param {boolean} isStub - True si c'est un stub vide (pas de média)
 * @returns {boolean} True si traité
 */
async function processViewOnce(sock, msg, botState, myJid, isStub = false) {
    const id = msg?.key?.id;
    if (!id) return false;

    if (isAlreadyProcessing(id)) return false;
    markProcessing(id);

    // ==========================================
    // CAS STUB : pas de média → auto-citation
    // ==========================================
    if (isStub) {
        console.log(`🦅 [AUTO-VO] Stub détecté (${id}) → envoi d'une réponse citée`);
        try {
            await sock.sendMessage(msg.key.remoteJid, {
                text: '\u200b', // Zero-width space (invisible)
                quoted: msg
            });
            console.log(`✅ [AUTO-VO] Réponse citée envoyée, attente du contenu...`);
        } catch (e) {
            console.error(`❌ [AUTO-VO] Erreur auto-citation: ${e.message}`);
        }
        return true;
    }

    // ==========================================
    // CAS COMPLET : on a le média
    // ==========================================
    const { inner, isViewOnce, wrappers } = deepUnwrap(msg.message);

    if (!isViewOnce || !inner) {
        console.log(`⚠️ [AUTO-VO] Pas un View Once valide (wrappers: ${wrappers.join(',')})`);
        return false;
    }

    const mediaType = getMediaType(inner);
    if (!mediaType) {
        console.log(`⚠️ [AUTO-VO] Type de média non supporté`);
        return false;
    }

    console.log(`🦅 [AUTO-VO] Traitement complet (${mediaType}) | wrappers: ${wrappers.join(',')}`);

    try {
        // Retire les flags viewOnce pour permettre le download
        stripViewOnceFlags(inner);

        const mediaMsg = {
            key: msg.key,
            message: inner
        };

        const buffer = await downloadMediaMessage(
            mediaMsg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest }
        );

        if (!buffer || buffer.length === 0) {
            console.log('⚠️ [AUTO-VO] Média vide');
            return false;
        }

        // ==========================================
        // ENVOI DANS LE DM
        // ==========================================
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const senderName = botState.contactNames[senderJid] || senderJid.split('@')[0];
        const chatName = msg.key.remoteJid?.endsWith('@g.us')
            ? (botState.contactNames[msg.key.remoteJid] || 'Groupe')
            : 'Privé';

        const caption = `🦅 *Vue unique*\n👤 De : ${senderName}\n💬 Dans : ${chatName}`;

        if (mediaType === 'image') {
            await sock.sendMessage(myJid, { image: buffer, caption });
        } else if (mediaType === 'video') {
            await sock.sendMessage(myJid, { video: buffer, caption });
        } else if (mediaType === 'audio') {
            const audioMeta = inner.audioMessage || inner.pttMessage;
            await sock.sendMessage(myJid, { text: caption });
            await sock.sendMessage(myJid, {
                audio: buffer,
                mimetype: audioMeta?.mimetype || 'audio/ogg; codecs=opus',
                ptt: true
            });
        } else {
            await sock.sendMessage(myJid, { text: `${caption}\n⚠️ Type : ${mediaType}` });
        }

        console.log(`✅ [AUTO-VO] Média envoyé dans ton DM (${(buffer.length / 1024).toFixed(1)} KB)`);
        return true;
    } catch (e) {
        console.error(`❌ [AUTO-VO] Erreur download: ${e.message}`);
        return false;
    }
}

module.exports = { processViewOnce, isViewOnceStub };
