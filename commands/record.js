const { resolveTarget, parseDuration, formatDuration, startSimulation } = require('../core/presence');

module.exports = {
    name: 'record',
    aliases: ['recording', 'enregistre'],
    description: 'Simule un enregistrement vocal vers une cible',
    async execute(sock, msg, botState, ctx) {
        // Parse identique à !type
        let input = ctx.args[0];
        let durationStr = ctx.args[1];

        if (input && parseDuration(input)) {
            durationStr = input;
            input = null;
        }

        const target = resolveTarget(input, msg, ctx);
        if (target.error) {
            await sock.sendMessage(ctx.from, { text: target.error }, { quoted: msg });
            return;
        }

        const durationMs = parseDuration(durationStr);

        if (durationStr && !durationMs) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Format de durée invalide. Exemples : 30s, 5m, 1h'
            }, { quoted: msg });
            return;
        }

        if (durationMs && durationMs > 4 * 60 * 60 * 1000) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Maximum : 4 heures.'
            }, { quoted: msg });
            return;
        }

        const result = await startSimulation(sock, target.jid, 'recording', durationMs, target.name);
        if (result.error) {
            await sock.sendMessage(ctx.from, { text: result.error }, { quoted: msg });
            return;
        }

        const durLabel = durationMs ? formatDuration(durationMs) : '∞ (jusqu\'à !stop)';
        await sock.sendMessage(ctx.from, {
            text: `🎤 Enregistrement simulé\n` +
                  `👤 Cible : *${target.name}*\n` +
                  `⏱️ Durée : ${durLabel}`
        }, { quoted: msg });
    }
};
