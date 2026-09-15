const { formatUptime } = require('../core/stats');

module.exports = {
    name: 'runtime',
    aliases: ['uptime', 'duree', 'session'],
    description: 'Affiche la durée d\'activité du bot',
    async execute(sock, msg, botState, ctx) {
        const uptimeMs = Date.now() - botState.START_TIME;
        const uptimeStr = formatUptime(uptimeMs);

        const startDate = new Date(botState.START_TIME);
        const startStr = startDate.toLocaleString('fr-FR');

        // Mémoire utilisée
        const mem = process.memoryUsage();
        const memMB = (mem.rss / 1024 / 1024).toFixed(1);

        // Version Node
        const nodeVersion = process.version;

        await sock.sendMessage(ctx.from, {
            text: `⏱️ *Runtime du bot*\n\n` +
                  `🟢 En ligne depuis : *${uptimeStr}*\n` +
                  `📅 Démarré le : ${startStr}\n` +
                  `💾 Mémoire : ${memMB} MB\n` +
                  `⚙️ Node.js : ${nodeVersion}`
        }, { quoted: msg });
    }
};
