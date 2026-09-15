// ==========================================
// SUIVI DES PRÉSENCES
// ==========================================
const presenceMap = new Map();

function updatePresence(jid, presence) {
    if (!jid || !presence) return;
    presenceMap.set(jid, {
        lastKnownPresence: presence.lastKnownPresence,
        lastSeen: presence.lastSeen,
        timestamp: Date.now()
    });
}

function getPresence(jid) {
    return presenceMap.get(jid) || null;
}

function getOnlineContacts() {
    const online = [];
    for (const [jid, data] of presenceMap.entries()) {
        if (data.lastKnownPresence === 'available' || data.lastKnownPresence === 'composing' || data.lastKnownPresence === 'recording') {
            online.push({ jid, ...data });
        }
    }
    return online;
}

function getAllPresences() {
    const all = [];
    for (const [jid, data] of presenceMap.entries()) {
        all.push({ jid, ...data });
    }
    return all;
}

module.exports = { updatePresence, getPresence, getOnlineContacts, getAllPresences, presenceMap };
