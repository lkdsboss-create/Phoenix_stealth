// Stockage des spams actifs
const activeSpams = new Map();

module.exports = {
    name: 'spam',
    aliases: ['flood', 'bomb'],
    description: 'Envoie un message plusieurs fois (max 30)',
    async execute(sock, msg, botState, ctx) {
        // Parse : !spam <n> <texte>
        const countStr = ctx.args[0];
        const text = ctx.args.slice(1).join(' ').trim();

        if (!countStr || !text) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Usage : `!spam <nombre> <texte>`\n\n' +
                      'Exemple : `!spam 5 Bonjour`\n' +
                      'Maximum : 30 fois'
            }, { quoted: msg });
            return;
        }

        const count = parseInt(countStr);
        if (isNaN(count) || count < 1 || count > 30) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Le nombre doit être entre 1 et 30.'
            }, { quoted: msg });
            return;
        }

        // Annule un éventuel spam en cours dans ce chat
        if (activeSpams.has(ctx.from)) {
            const prev = activeSpams.get(ctx.from);
            prev.cancelled = true;
            activeSpams.delete(ctx.from);
        }

        // Démarre le spam
        const controller = { cancelled: false };
        activeSpams.set(ctx.from, controller);

        await sock.sendMessage(ctx.from, {
            text: `🚀 Envoi de ${count} messages...\n` +
                  `💡 Tape \`!spamstop\` pour arrêter.`
        }, { quoted: msg });

        console.log(`💣 [SPAM] ${count} message(s) → ${ctx.from}`);

        for (let i = 0; i < count; i++) {
            if (controller.cancelled) {
                console.log(`🛑 [SPAM] Annulé à ${i}/${count}`);
                break;
            }

            try {
                await sock.sendMessage(ctx.from, { text });
            } catch (e) {
                console.error(`⚠️ [SPAM] Erreur envoi ${i + 1}:`, e.message);
                break;
            }

            // Délai anti-ban : 600 ms entre chaque
            if (i < count - 1) {
                await new Promise(r => setTimeout(r, 600));
            }
        }

        activeSpams.delete(ctx.from);

        if (!controller.cancelled) {
            console.log(`✅ [SPAM] Terminé (${count})`);
        }
    },
    activeSpams
};
