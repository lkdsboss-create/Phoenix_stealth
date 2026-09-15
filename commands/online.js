const { probeAllContacts } = require('../core/silentTracker');

module.exports = {
    name: 'online',
    aliases: ['enligne', 'actifs'],
    description: 'Sonde les contacts pour voir qui est en ligne',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;

        // ==========================================
        // PARSE DE L'ARGUMENT (limite optionnelle)
        // ==========================================
        let limit = null;
        if (ctx.args[0]) {
            const parsed = parseInt(ctx.args[0]);
            if (!isNaN(parsed) && parsed > 0) {
                limit = parsed;
            }
        }

        // ==========================================
        // RÉCUPÉRATION DES CONTACTS
        // ==========================================
        let allJids = Object.keys(botState.contactNames)
            .filter(jid =>
                jid &&
                !jid.endsWith('@g.us') &&
                jid !== 'status@broadcast' &&
                jid.includes('@s.whatsapp.net')
            );

        // Applique la limite si fournie
        const total = allJids.length;
        if (limit && limit < allJids.length) {
            allJids = allJids.slice(0, limit);
        }

        if (allJids.length === 0) {
            await sock.sendMessage(myJid, { text: '📭 Aucun contact enregistré.' });
            return;
        }

        const limitLabel = limit ? ` (limité à ${limit})` : ' (tous)';
        await sock.sendMessage(myJid, {
            text: `📡 *Sondage silencieux en cours...*\n👥 ${allJids.length}/${total} contact(s)${limitLabel} · timeout 3s`
        });

        console.log(`📡 [TRACKER] Sondage de ${allJids.length}/${total} contact(s)`);

        // ==========================================
        // SONDE EN PARALLÈLE
        // ==========================================
        const results = await probeAllContacts(sock, allJids, 3000);

        const online = [];
        const offline = [];

        for (const [jid, result] of results.entries()) {
            const name = botState.contactNames[jid] || jid.split('@')[0].split(':')[0];
            if (result.online) {
                online.push({ jid, name, rtt: result.rtt });
            } else {
                offline.push({ jid, name });
            }
        }

        online.sort((a, b) => a.rtt - b.rtt);

        // ==========================================
        // CONSTRUCTION DU MESSAGE
        // ==========================================
        let response = `📡 *SONDAGE TERMINÉ*\n\n`;

        if (online.length > 0) {
            response += `🟢 *EN LIGNE (${online.length})*\n`;
            for (const o of online) {
                response += `• ${o.name} — ${o.rtt}ms\n`;
            }
            response += `\n`;
        } else {
            response += `🟢 *EN LIGNE : aucun*\n\n`;
        }

        if (offline.length > 0) {
            response += `⚫ *HORS LIGNE (${offline.length})*\n`;
            for (const o of offline) {
                response += `• ${o.name}\n`;
            }
        }

        response += `\n📊 Sondé : ${allJids.length}/${total}`;
        if (limit) response += `\n💡 Pour sonder tout : \`!online\` sans argument`;

        await sock.sendMessage(myJid, { text: response });
        console.log(`✅ [TRACKER] ${online.length} en ligne / ${offline.length} hors ligne`);
    }
};
