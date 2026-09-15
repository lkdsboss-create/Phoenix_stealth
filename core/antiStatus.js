// ==========================================
// CAPTURE DE STATUTS
// ==========================================
const statusCache = new Map(); // clé: senderJid → { msg, timestamp }

const STATUS_TTL = 24 * 60 * 60 * 1000;

function cacheStatus(msg) {
    if (!msg || !msg.key) return;
    const sender = msg.key.participant || msg.key.remoteJid;
    if (!sender) return;
    statusCache.set(sender, { msg, timestamp: Date.now() });
}

function getStatus(senderJid) {
    const entry = statusCache.get(senderJid);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > STATUS_TTL) {
        statusCache.delete(senderJid);
        return null;
    }
    return entry.msg;
}

function getAllStatusSenders() {
    const senders = [];
    for (const [jid, entry] of statusCache.entries()) {
        senders.push({ jid, timestamp: entry.timestamp });
    }
    return senders.sort((a, b) => b.timestamp - a.timestamp);
}

function cleanupStatusCache() {
    const now = Date.now();
    for (const [key, entry] of statusCache.entries()) {
        if (now - entry.timestamp > STATUS_TTL) {
            statusCache.delete(key);
        }
    }
}

setInterval(cleanupStatusCache, 3600000);

module.exports = { cacheStatus, getStatus, getAllStatusSenders, statusCache };
