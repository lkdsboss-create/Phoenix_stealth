const { getContactName, contacts } = require('./contacts');

// ==========================================
// ÉTAT DES SIMULATIONS ACTIVES
// ==========================================
// clé: jid → { state: 'composing'|'recording', keepAlive, timer, startTime, duration, targetName }
const activeSimulations = new Map();

const KEEP_ALIVE_MS = 5000;              // Renouvelle l'indicateur toutes les 5s
const MAX_DURATION_MS = 4 * 60 * 60 * 1000; // Sécurité : 4h max

// ==========================================
// RÉSOLUTION DE CIBLE
// ==========================================

/**
 * Résout une cible en JID à partir de :
 * - un numéro (22896081989)
 * - un nom de contact (Blue Bird)
 * - le chat courant (fallback)
 * - un message cité (reply)
 */
function resolveTarget(input, msg, ctx) {
    // 1. Reply → priorité maximale
    const quoted = msg.message?.extendedTextMessage?.contextInfo;
    if (!input && quoted?.participant) {
        return { jid: quoted.participant, name: getContactName(quoted.participant) };
    }
    if (!input && quoted?.remoteJid && !quoted.remoteJid.endsWith('@g.us')) {
        return { jid: quoted.remoteJid, name: getContactName(quoted.remoteJid) };
    }

    // 2. Pas d'input → chat courant
    if (!input) {
        return { jid: ctx.from, name: getContactName(ctx.from) };
    }

    // 3. Input numérique → JID direct
    const cleaned = String(input).replace(/\D/g, '');
    if (cleaned.length >= 7 && cleaned.length <= 15) {
        const jid = cleaned + '@s.whatsapp.net';
        return { jid, name: getContactName(jid) };
    }

    // 4. Input nom → recherche partielle
    const search = String(input).toLowerCase().trim();
    const allContacts = contacts();
    const matches = [];

    for (const [jid, name] of Object.entries(allContacts)) {
        if (jid.endsWith('@g.us')) continue;
        if (name.toLowerCase().includes(search)) {
            matches.push({ jid, name });
        }
    }

    if (matches.length === 0) {
        return { error: `❌ Aucun contact contenant "${input}"` };
    }
    if (matches.length > 1) {
        const list = matches.slice(0, 5).map(m => `• ${m.name}`).join('\n');
        return { error: `⚠️ Plusieurs contacts trouvés :\n${list}\n\nPrécise le nom ou utilise le numéro.` };
    }

    return { jid: matches[0].jid, name: matches[0].name };
}

// ==========================================
// PARSING DE DURÉE
// ==========================================
function parseDuration(str) {
    if (!str) return null;
    const match = String(str).toLowerCase().match(/^(\d+)([smh]?)$/);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2] || 's';
    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    return null;
}

function formatDuration(ms) {
    if (!ms) return '';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    let out = '';
    if (h > 0) out += `${h}h`;
    if (m > 0) out += `${m}m`;
    if (s > 0 && h === 0) out += `${s}s`;
    return out || '0s';
}

// ==========================================
// DÉMARRER UNE SIMULATION
// ==========================================
async function startSimulation(sock, jid, state, durationMs, targetName) {
    // Arrête l'existant sur cette cible
    stopSimulation(sock, jid);

    try {
        await sock.sendPresenceUpdate(state, jid);
    } catch (e) {
        return { error: `❌ Impossible d'envoyer la présence à ${targetName} : ${e.message}` };
    }

    // Keep-alive : renouvelle l'indicateur régulièrement
    const keepAlive = setInterval(async () => {
        try {
            await sock.sendPresenceUpdate(state, jid);
        } catch (e) {
            // Silencieux
        }
    }, KEEP_ALIVE_MS);

    // Sécurité : arrêt auto après MAX_DURATION
    const effectiveDuration = durationMs || MAX_DURATION_MS;

    const timer = setTimeout(async () => {
        await stopSimulation(sock, jid);
        console.log(`⏰ [PRESENCE] Fin auto pour ${jid} (${targetName})`);
    }, effectiveDuration);

    activeSimulations.set(jid, {
        state,
        keepAlive,
        timer,
        startTime: Date.now(),
        duration: durationMs,
        targetName
    });

    console.log(`👻 [PRESENCE] ${state} démarré pour ${targetName} (${jid})`);
    return { success: true };
}

// ==========================================
// ARRÊTER UNE SIMULATION
// ==========================================
async function stopSimulation(sock, jid) {
    const sim = activeSimulations.get(jid);
    if (!sim) return false;

    if (sim.keepAlive) clearInterval(sim.keepAlive);
    if (sim.timer) clearTimeout(sim.timer);

    try {
        await sock.sendPresenceUpdate('paused', jid);
    } catch (e) {}

    activeSimulations.delete(jid);
    console.log(`🛑 [PRESENCE] Arrêté pour ${sim.targetName} (${jid})`);
    return true;
}

async function stopAllSimulations(sock) {
    const list = [...activeSimulations.keys()];
    for (const jid of list) {
        await stopSimulation(sock, jid);
    }
    return list.length;
}

function getActiveSimulations() {
    const list = [];
    for (const [jid, sim] of activeSimulations.entries()) {
        list.push({
            jid,
            name: sim.targetName,
            state: sim.state,
            startTime: sim.startTime,
            duration: sim.duration,
            elapsed: Date.now() - sim.startTime
        });
    }
    return list;
}

module.exports = {
    resolveTarget,
    parseDuration,
    formatDuration,
    startSimulation,
    stopSimulation,
    stopAllSimulations,
    getActiveSimulations,
    activeSimulations
};
