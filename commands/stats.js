const { getStats, formatUptime, resetStats } = require('../core/stats');

module.exports = {
    name: 'stats',
    aliases: ['statistiques', 'usage'],
    description: 'Affiche les statistiques d\'usage du bot',
    async execute(sock, msg, botState, ctx) {
        const arg = ctx.args[0]?.toLowerCase();

        // Reset
        if (arg === 'reset') {
            resetStats();
            await sock.sendMessage(ctx.from, {
                text: '🧹 Statistiques remises à zéro.'
            }, { quoted: msg });
            return;
        }

        const s = getStats();
        const uptimeStr = formatUptime(s.uptimeMs);

        let text = `📊 *Statistiques Phoenix*\n\n`;
        text += `⏱️ Uptime : ${uptimeStr}\n`;
        text += `📥 Messages reçus : ${s.messagesReceived}\n`;
        text += `📤 Messages envoyés : ${s.messagesSent}\n`;
        text += `🎯 Commandes exécutées : ${s.commandsExecuted}\n`;

        if (s.lastCommandName) {
            const lastTime = new Date(s.lastCommandAt).toLocaleTimeString('fr-FR');
            text += `\n🕐 Dernière commande : *!${s.lastCommandName}* à ${lastTime}\n`;
        }

        if (s.topCommands.length > 0) {
            text += `\n🏆 *Top commandes :*\n`;
            for (let i = 0; i < s.topCommands.length; i++) {
                const [name, count] = s.topCommands[i];
                const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] || '▫️';
                text += `${medal} !${name} — ${count} fois\n`;
            }
        }

        text += `\n💡 \`!stats reset\` pour remettre à zéro.`;

        await sock.sendMessage(ctx.from, { text }, { quoted: msg });
    }
};
