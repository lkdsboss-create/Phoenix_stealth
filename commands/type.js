const { resolveTarget, parseDuration, formatDuration, startSimulation } = require('../core/presence');

module.exports = {
    name: 'type',
    aliases: ['typing', 'ecrit'],
    description: 'Simule la frappe vers une cible (nom, numéro, reply ou chat courant)',
    async execute(sock, msg, botState, ctx) {
        // Parse : !type [cible] [durée]
        // Exemples :
        //   !type                       → chat courant, infini
        //   !type 30s                   → chat courant, 30s
        //   !type Blue                  → cible "Blue", infini
        //   !type Blue 2m               → cible "Blue", 2m
        //   !type 22896081989 45s       → cible par numéro, 45s
        //   (reply) !type 1m            → cible du reply, 1m

        let input = ctx.args[0];
        let durationStr = ctx.args[1];

        // Si le premier arg est une durée → pas de cible, chat courant
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

        const result = await startSimulation(sock, target.jid, 'composing', durationMs, target.name);
        if (result.error) {
            await sock.sendMessage(ctx.from, { text: result.error }, { quoted: msg });
            return;
        }

        const durLabel = durationMs ? formatDuration(durationMs) : '∞ (jusqu\'à !stop)';
        await sock.sendMessage(ctx.from, {
            text: `⌨️ Frappe simulée\n` +
                  `👤 Cible : *${target.name}*\n` +
                  `⏱️ Durée : ${durLabel}`
        }, { quoted: msg });
    }
};
