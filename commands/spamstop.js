const { activeSpams } = require('./spam');

module.exports = {
    name: 'spamstop',
    aliases: ['stopspam'],
    description: 'Arrête un spam en cours',
    async execute(sock, msg, botState, ctx) {
        const controller = activeSpams.get(ctx.from);

        if (!controller) {
            await sock.sendMessage(ctx.from, {
                text: '📭 Aucun spam en cours dans ce chat.'
            }, { quoted: msg });
            return;
        }

        controller.cancelled = true;
        activeSpams.delete(ctx.from);

        await sock.sendMessage(ctx.from, {
            text: '🛑 Spam arrêté.'
        }, { quoted: msg });

        console.log('🛑 [SPAMSTOP] Spam annulé');
    }
};
