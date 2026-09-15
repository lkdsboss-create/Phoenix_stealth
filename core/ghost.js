// ==========================================
// MODE FANTÔME - Suppression auto des commandes
// ==========================================
const ghostState = {
    enabled: true,           // Mode fantôme actif par défaut
    delayMs: 80,            // Délai avant suppression
    stats: {
        totalDeleted: 0,
        lastDeleted: null
    }
};

/**
 * Programme la suppression d'un message après un court délai.
 * Vérifie que c'est bien une commande propriétaire.
 */
function scheduleGhostDelete(sock, msg, commandName) {
    if (!ghostState.enabled) return;

    const jid = msg.key.remoteJid;
    const key = msg.key;

    // Ne supprime QUE les commandes du propriétaire (fromMe)
    if (!msg.key.fromMe) return;

    // Ne supprime PAS dans le chat "Message à moi-même"
    // (dans ce cas, pas grave, mais évitons les comportements bizarres)
    // En réalité on peut le faire, mais laissons simple

    setTimeout(async () => {
        try {
            await sock.sendMessage(jid, { delete: key });
            ghostState.stats.totalDeleted++;
            ghostState.stats.lastDeleted = {
                command: commandName,
                jid,
                time: new Date().toISOString()
            };
            console.log(`👻 [GHOST] Commande "!${commandName}" supprimée`);
        } catch (e) {
            // Erreur silencieuse : WhatsApp peut refuser (message trop vieux, etc.)
            console.log(`⚠️ [GHOST] Suppression impossible : ${e.message}`);
        }
    }, ghostState.delayMs);
}

function setGhostEnabled(enabled) {
    ghostState.enabled = Boolean(enabled);
    return ghostState.enabled;
}

function isGhostEnabled() {
    return ghostState.enabled;
}

function setGhostDelay(ms) {
    ghostState.delayMs = Math.max(100, Math.min(10000, Number(ms) || 800));
    return ghostState.delayMs;
}

function getGhostStats() {
    return { ...ghostState.stats, enabled: ghostState.enabled, delayMs: ghostState.delayMs };
}

module.exports = {
    scheduleGhostDelete,
    setGhostEnabled,
    isGhostEnabled,
    setGhostDelay,
    getGhostStats
};
