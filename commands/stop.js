const { resolveTarget, stopSimulation, stopAllSimulations, getActiveSimulations, formatDuration } = require('../core/presence');

module.exports = {
    name: 'stop',
    aliases: ['arrete', 'halt'],
    description: 'Arrête les simulations de présence',
    async execute(sock, msg, botState, ctx) {
        const arg = ctx.args[0];

        // ==========================================
        // !stop list → liste les simulations actives
        // ==========================================
        if (arg === 'list' || arg === 'liste') {
            const active = getActiveSimulations();
            if (active.length === 0) {
                await sock.sendMessage(ctx.from, {
                    text: '📭 Aucune simulation active.'
                }, { quoted: msg });
                return;
            }

            let text = `👻 *Simulations actives (${active.length})*\n\n`;
            for (const s of active) {
                const icon = s.state === 'composing' ? '⌨️' : '🎤';
                text += `${icon} *${s.name}*\n`;
                text += `   ⏱️ Depuis ${formatDuration(s.elapsed)}`;
                if (s.duration) text += ` / ${formatDuration(s.duration)}`;
                text += `\n\n`;
            }

            await sock.sendMessage(ctx.from, { text }, { quoted: msg });
            return;
        }

        // ==========================================
        // !stop → arrêt global
        // ==========================================
        if (!arg) {
            const count = await stopAllSimulations(sock);
            if (count === 0) {
                await sock.sendMessage(ctx.from, {
                    text: '📭 Aucune simulation active.'
                }, { quoted: msg });
            } else {
                await sock.sendMessage(ctx.from, {
                    text: `🛑 ${count} simulation(s) arrêtée(s).`
                }, { quoted: msg });
            }
            return;
        }

        // ==========================================
        // !stop <cible> → arrêt ciblé
        // ==========================================
        const target = resolveTarget(arg, msg, ctx);
        if (target.error) {
            await sock.sendMessage(ctx.from, { text: target.error }, { quoted: msg });
            return;
        }

        const stopped = await stopSimulation(sock, target.jid);
        if (stopped) {
            await sock.sendMessage(ctx.from, {
                text: `🛑 Simulation arrêtée pour *${target.name}*`
            }, { quoted: msg });
        } else {
            await sock.sendMessage(ctx.from, {
                text: `📭 Aucune simulation active pour *${target.name}*`
            }, { quoted: msg });
        }
    }
};
