const { getOnlineContacts, getAllPresences } = require('../core/presenceTracker');

module.exports = {
    name: 'online',
    aliases: ['on', 'enligne'],
    description: 'Affiche les contacts en ligne actuellement',
    async execute(sock, msg, botState, ctx) {
        const online = getOnlineContacts();
        const all = getAllPresences();

        if (all.length === 0) {
            await sock.sendMessage(ctx.from, {
                text: '📡 Aucune présence suivie pour l\'instant.\n\nLe bot apprend les présences au fur et à mesure des messages.'
            }, { quoted: msg });
            return;
        }

        let text = `📡 *Contacts en ligne : ${online.length}*\n\n`;

        if (online.length > 0) {
            for (const p of online) {
                const num = p.jid.split('@')[0].split(':')[0];
                const state = p.lastKnownPresence === 'composing' ? '✍️ écrit'
                            : p.lastKnownPresence === 'recording' ? '🎤 enregistre'
                            : '🟢 en ligne';
                text += `• @${num} — ${state}\n`;
            }
        } else {
            text += 'Personne n\'est en ligne actuellement.\n';
        }

        text += `\n📊 Total de contacts suivis : ${all.length}`;

        const mentions = online.map(p => p.jid);

        await sock.sendMessage(ctx.from, {
            text,
            mentions
        }, { quoted: msg });
    }
};
