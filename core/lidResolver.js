// ==========================================
// RÉSOLUTION DES LID (Linked IDs)
// ==========================================
// 3 méthodes en cascade pour résoudre un LID en vrai numéro :
// 1. API native Baileys (sock.signalRepository.lidMapping)
// 2. Cache global lidPhoneCache (alimenté par lid-mapping.update)
// 3. sock.onWhatsApp (fallback API)

const lidToPhoneCache = new Map();
const phoneToLidCache = new Map();

/**
 * Enregistre manuellement une correspondance LID → phone.
 */
function registerMapping(lid, phone) {
    if (!lid || !phone) return;
    const lidNum = String(lid).split('@')[0].split(':')[0];
    const phoneNum = String(phone).split('@')[0].split(':')[0].replace(/\D/g, '');
    if (lidNum && phoneNum) {
        lidToPhoneCache.set(lidNum, phoneNum);
        phoneToLidCache.set(phoneNum, lidNum);
    }
}

/**
 * Résolution via l'API native de Baileys (la plus fiable).
 */
function resolveViaBaileys(sock, lid) {
    try {
        const signalRepo = sock?.signalRepository;
        if (!signalRepo?.lidMapping) return null;

        const lidNum = String(lid).split('@')[0].split(':')[0];
        const lidJid = lidNum + '@lid';

        // API : getPNForLID(lid)
        if (typeof signalRepo.lidMapping.getPNForLID === 'function') {
            const pn = signalRepo.lidMapping.getPNForLID(lidJid);
            if (pn) {
                const phoneNum = String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
                if (phoneNum) {
                    lidToPhoneCache.set(lidNum, phoneNum);
                    return phoneNum;
                }
            }
        }

        // API alternative : getPNForLID avec @lid en argument
        if (typeof signalRepo.lidMapping.getPNForLID === 'function') {
            const pn = signalRepo.lidMapping.getPNForLID(lid);
            if (pn) {
                const phoneNum = String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
                if (phoneNum) {
                    lidToPhoneCache.set(lidNum, phoneNum);
                    return phoneNum;
                }
            }
        }
    } catch (e) {
        // Silencieux
    }
    return null;
}

/**
 * Résolution via le cache global.
 */
function resolveViaCache(lid) {
    const lidNum = String(lid).split('@')[0].split(':')[0];
    if (globalThis.lidPhoneCache?.has(lidNum)) {
        return globalThis.lidPhoneCache.get(lidNum);
    }
    if (lidToPhoneCache.has(lidNum)) {
        return lidToPhoneCache.get(lidNum);
    }
    return null;
}

/**
 * Résolution via sock.onWhatsApp (méthode fallback).
 */
async function resolveViaOnWhatsApp(sock, lid) {
    try {
        const result = await sock.onWhatsApp(lid);
        if (result && result[0] && result[0].jid) {
            const phoneNum = result[0].jid.split('@')[0].split(':')[0].replace(/\D/g, '');
            if (phoneNum) {
                const lidNum = String(lid).split('@')[0].split(':')[0];
                lidToPhoneCache.set(lidNum, phoneNum);
                return phoneNum;
            }
        }
    } catch (e) {
        // Silencieux
    }
    return null;
}

/**
 * Fonction principale : essaie toutes les méthodes.
 */
async function resolveLidToPhone(sock, lid) {
    if (!lid) return null;
    const lidNum = String(lid).split('@')[0].split(':')[0];

    // Déjà résolu
    if (lidToPhoneCache.has(lidNum)) return lidToPhoneCache.get(lidNum);

    // Méthode 1 : API Baileys
    let phone = resolveViaBaileys(sock, lid);
    if (phone) return phone;

    // Méthode 2 : Cache global
    phone = resolveViaCache(lid);
    if (phone) return phone;

    // Méthode 3 : onWhatsApp (async, plus lent)
    phone = await resolveViaOnWhatsApp(sock, lid);
    if (phone) return phone;

    return null;
}

module.exports = {
    resolveLidToPhone,
    registerMapping,
    lidToPhoneCache,
    phoneToLidCache
};
