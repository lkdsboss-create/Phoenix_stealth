const { probeContact } = require('../core/silentTracker');

// ==========================================
// ANTI-SPAM : 1 sonde par contact par minute
// ==========================================
const lastProbe = new Map(); // jid → timestamp
const MIN_INTERVAL = 60 * 1000; // 60 secondes

module.exports = {
    name: 'online',
    aliases: ['enligne', 'actifs'],
    description: 'Sonde UN SEUL contact pour voir s\'il est en ligne',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;

        // ==========================================
        // ARGUMENT OBLIGATOIRE
        // ==========================================
        const arg = ctx.args.join(' ').trim();
        if (!arg) {
            await sock.sendMessage(myJid, {
                text: `❌ Usage : \`!online <numéro ou nom>\`\n\n` +
                      `Exemples :\n` +
                      `• \`!online 22896081989\`\n` +
                      `• \`!online Blue\`\n\n` +
                      `⚠️ Une seule personne à la fois (anti-spam WhatsApp).`
            });
            return;
        }

        // ==========================================
        // RÉSOLUTION DE LA CIBLE
        // ==========================================
        let targetJid = null;
        let targetName = arg;

        // 1. Numéro direct
        const cleanNum = arg.replace(/\D/g, '');
        if (cleanNum.length >= 7 && cleanNum.length <= 15) {
            targetJid = cleanNum + '@s.whatsapp.net';
        } else {
            // 2. Recherche par nom (partielle)
            const search = arg.toLowerCase();
            for (const [jid, name] of Object.entries(botState.contactNames)) {
                if (jid.endsWith('@g.us')) continue;
                if (name.toLowerCase().includes(search)) {
                    targetJid = jid;
                    targetName = name;
                    break;
                }
            }
        }

        if (!targetJid) {
            await sock.sendMessage(myJid, { text: `❌ Aucun contact trouvé pour "${arg}".` });
            return;
        }

        // ==========================================
        // ANTI-SPAM
        // ==========================================
        const now = Date.now();
        const last = lastProbe.get(targetJid);
        if (last && (now - last) < MIN_INTERVAL) {
            const wait = Math.ceil((MIN_INTERVAL - (now - last)) / 1000);
            await sock.sendMessage(myJid, {
                text: `⏱️ Attends encore ${wait}s avant de re-sonder ${targetName}.\n\n(Protection anti-spam WhatsApp)`
            });
            return;
        }
        lastProbe.set(targetJid, now);

        // ==========================================
        // SONDE
        // ==========================================
        console.log(`📡 [TRACKER] Sonde unique → ${targetName} (${targetJid})`);

        const result = await probeContact(sock, targetJid, 3000);

        // ==========================================
        // RÉSULTAT
        // ==========================================
        let state = '⚫ Hors ligne';
        let rtt = '—';

        if (result.online) {
            rtt = `${result.rtt}ms`;
            if (result.rtt < 300) state = '🟢 Actif (app au premier plan)';
            else if (result.rtt < 1000) state = '🟢 Écran allumé';
            else if (result.rtt < 3000) state = '🟡 Écran éteint mais connecté';
            else state = '🟡 En veille';
        }

        await sock.sendMessage(myJid, {
            text: `📡 *Sonde silencieuse*\n\n` +
                  `👤 *${targetName}*\n` +
                  `📱 État : ${state}\n` +
                  `⏱️ RTT : ${rtt}\n\n` +
                  `💡 Nouvelle sonde possible dans 60s`
        });
    }
};
