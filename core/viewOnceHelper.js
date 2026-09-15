// ==========================================
// HELPER VIEW ONCE - Détection et déballage avancé
// ==========================================

// Tous les wrappers possibles (ordre d'importance)
const VO_WRAPPERS = [
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'viewOnceMessageV3',
    'ptvMessage'      // Push-to-video (vidéo ronde)
];

// Wrappers de transport (à traverser sans marquer View Once)
const TRANSPORT_WRAPPERS = [
    'ephemeralMessage',
    'documentWithCaptionMessage',
    'deviceSentMessage',
    'editedMessage',
    'futureProofMessage',
    'associatedChildMessage'  // ← AJOUT : fix Issue #1872
];

/**
 * Vérifie si un message est un stub View Once (contenu absent).
 * WhatsApp envoie ça quand il refuse de transmettre le média.
 */
function isViewOnceStub(msg) {
    if (!msg) return false;
    if (msg.messageStubType === 2) return true;
    if (Array.isArray(msg.messageStubParameters)) {
        return msg.messageStubParameters.some(p =>
            typeof p === 'string' && p.toLowerCase().includes('absent')
        );
    }
    return false;
}

/**
 * Déplie récursivement tous les wrappers d'un message.
 * Retourne { inner, isViewOnce, wrappers }.
 */
function deepUnwrap(message) {
    if (!message) return { inner: null, isViewOnce: false, wrappers: [] };

    let cur = message;
    let isViewOnce = false;
    const wrappers = [];

    for (let i = 0; i < 20; i++) {
        let found = false;

        for (const w of VO_WRAPPERS) {
            if (cur[w]?.message) {
                wrappers.push(w);
                isViewOnce = true;
                cur = cur[w].message;
                found = true;
                break;
            }
        }
        if (found) continue;

        for (const w of TRANSPORT_WRAPPERS) {
            if (cur[w]?.message) {
                wrappers.push(w);
                cur = cur[w].message;
                found = true;
                break;
            }
        }
        if (!found) break;
    }

    // Détection du flag inline
    if (!isViewOnce) {
        if (cur.imageMessage?.viewOnce) isViewOnce = true;
        if (cur.videoMessage?.viewOnce) isViewOnce = true;
        if (cur.audioMessage?.viewOnce) isViewOnce = true;
        if (cur.ptvMessage?.viewOnce) isViewOnce = true;
    }

    return { inner: cur, isViewOnce, wrappers };
}

/**
 * Retire les flags viewOnce pour pouvoir télécharger le média.
 */
function stripViewOnceFlags(message) {
    if (!message) return message;
    for (const key in message) {
        if (message[key] && typeof message[key] === 'object' && 'viewOnce' in message[key]) {
            message[key].viewOnce = false;
        }
    }
    return message;
}

/**
 * Extrait le type de média d'un message déplié.
 */
function getMediaType(inner) {
    if (!inner) return null;
    if (inner.imageMessage) return 'image';
    if (inner.videoMessage) return 'video';
    if (inner.audioMessage) return 'audio';
    if (inner.ptvMessage) return 'video';
    if (inner.documentMessage) return 'document';
    if (inner.stickerMessage) return 'sticker';
    return null;
}

module.exports = {
    VO_WRAPPERS,
    TRANSPORT_WRAPPERS,
    isViewOnceStub,
    deepUnwrap,
    stripViewOnceFlags,
    getMediaType
};
