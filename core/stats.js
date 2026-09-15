// ==========================================
// STATISTIQUES DU BOT
// ==========================================
const stats = {
    messagesReceived: 0,
    messagesSent: 0,
    commandsExecuted: 0,
    commandsByType: {},       // { ping: 5, sticker: 12, ... }
    startTime: Date.now(),
    lastCommandAt: null,
    lastCommandName: null
};

function incrementMessagesReceived() {
    stats.messagesReceived++;
}

function incrementMessagesSent() {
    stats.messagesSent++;
}

function incrementCommand(name) {
    stats.commandsExecuted++;
    stats.commandsByType[name] = (stats.commandsByType[name] || 0) + 1;
    stats.lastCommandAt = Date.now();
    stats.lastCommandName = name;
}

function getStats() {
    return {
        ...stats,
        uptimeMs: Date.now() - stats.startTime,
        topCommands: Object.entries(stats.commandsByType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
    };
}

function resetStats() {
    stats.messagesReceived = 0;
    stats.messagesSent = 0;
    stats.commandsExecuted = 0;
    stats.commandsByType = {};
    stats.lastCommandAt = null;
    stats.lastCommandName = null;
}

// Formatage de durée
function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;

    const parts = [];
    if (d > 0) parts.push(`${d}j`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
    return parts.join(' ');
}

module.exports = {
    incrementMessagesReceived,
    incrementMessagesSent,
    incrementCommand,
    getStats,
    resetStats,
    formatUptime
};
