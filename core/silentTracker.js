// ==========================================
// TRACKING SILENCIEUX PAR RÉACTIONS
// ==========================================
// Envoie des réactions sur des IDs inexistants → WhatsApp répond
// par un accusé de livraison sans notifier la cible.
// Le RTT (temps de réponse) indique si l'appareil est en ligne.

const activeProbes = new Map(); // probeId → { jid, sentAt, resolve, timer }

/**
 * Envoie une sonde silencieuse à un JID.
 * Retourne un objet { online, rtt } après un timeout max.
 */
function probeContact(sock, jid, timeoutMs = 3000) {
    const probeId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const invalidKey = { remoteJid: jid, id: probeId, fromMe: true };

    return new Promise((resolve) => {
        const sentAt = Date.now();

        const timer = setTimeout(() => {
            activeProbes.delete(probeId);
            resolve({ online: false, rtt: null });
        }, timeoutMs);

        activeProbes.set(probeId, {
            jid,
            sentAt,
            resolve: (rtt) => {
                clearTimeout(timer);
                activeProbes.delete(probeId);
                resolve({ online: true, rtt });
            }
        });

        // Envoie la réaction sur un ID inexistant
        sock.sendMessage(jid, {
            react: { text: '👍', key: invalidKey }
        }).catch(() => {
            // Si l'envoi échoue immédiatement, considérer comme hors ligne
            clearTimeout(timer);
            activeProbes.delete(probeId);
            resolve({ online: false, rtt: null });
        });
    });
}

/**
 * Traite les accusés de livraison reçus. À appeler dans message-receipt.update.
 */
function handleDeliveryReceipt(events) {
    for (const receipt of events || []) {
        const id = receipt.key?.id;
        if (!id) continue;
        const probe = activeProbes.get(id);
        if (probe) {
            probe.resolve(Date.now() - probe.sentAt);
        }
    }
}

/**
 * Sonde plusieurs contacts en parallèle et retourne les résultats.
 */
async function probeAllContacts(sock, jids, timeoutMs = 3000) {
    const results = new Map();
    const promises = jids.map(async (jid) => {
        const result = await probeContact(sock, jid, timeoutMs);
        results.set(jid, result);
    });
    await Promise.all(promises);
    return results;
}

module.exports = { probeContact, probeAllContacts, handleDeliveryReceipt };
