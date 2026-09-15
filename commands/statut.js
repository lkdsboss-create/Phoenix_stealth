const { getAllStatusSenders } = require('../core/antiStatus');

module.exports = {
    name: 'statut',
    aliases: ['status', 'statuts'],
    description: 'Liste les personnes ayant posté un statut',
    async execute(sock, msg, botState, ctx) {
        const senders = getAllStatusSenders();

        if (senders.length === 0) {
            await sock.sendMessage(ctx.from, {
                text: '📭 Aucun statut capturé pour le moment.\n\nLe bot capture les statuts au fur et à mesure.'
            }, { quoted: msg });
            return;
        }

        let text = `📸 *Statuts récents (${senders.length})*\n\n`;

        for (const s of senders) {
            const num = s.jid.split('@')[0].split(':')[0];
            const time = new Date(s.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            text += `• @${num} — ${time}\n`;
        }

        text += `\n💡 Réponds à un message de la personne avec *!astatus* pour voir son statut.`;

        const mentions = senders.map(s => s.jid);

        await sock.sendMessage(ctx.from, {
            text,
            mentions
        }, { quoted: msg });
    }
};
