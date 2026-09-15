module.exports = {
    name: 'remind',
    aliases: ['rappel', 'r'],
    description: 'Programme un rappel',
    async execute(sock, msg, botState, ctx) {
        console.log('⏰ [REMIND] args:', ctx.args);

        if (ctx.args.length < 2) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Usage : !remind <durée> <message>\n\n' +
                      'Exemples :\n' +
                      '• !remind 10m Appeler maman\n' +
                      '• !remind 1h30m Sortir\n' +
                      '• !remind 45s Vérifier le four'
            }, { quoted: msg });
            return;
        }

        const durationStr = ctx.args[0].toLowerCase();
        const text = ctx.args.slice(1).join(' ');

        // Parse la durée : 10m, 1h30m, 45s, 2h
        const regex = /(\d+)([smh])/g;
        let match;
        let totalMs = 0;
        let matched = false;

        while ((match = regex.exec(durationStr)) !== null) {
            matched = true;
            const value = parseInt(match[1]);
            const unit = match[2];
            if (unit === 's') totalMs += value * 1000;
            else if (unit === 'm') totalMs += value * 60 * 1000;
            else if (unit === 'h') totalMs += value * 60 * 60 * 1000;
        }

        if (!matched || totalMs === 0) {
            await sock.sendMessage(ctx.from, { text: '❌ Durée invalide. Utilise : 30s, 10m, 1h, 1h30m' }, { quoted: msg });
            return;
        }

        if (totalMs > 24 * 60 * 60 * 1000) {
            await sock.sendMessage(ctx.from, { text: '❌ Maximum : 24h.' }, { quoted: msg });
            return;
        }

        const target = new Date(Date.now() + totalMs);
        const hh = String(target.getHours()).padStart(2, '0');
        const mm = String(target.getMinutes()).padStart(2, '0');

        await sock.sendMessage(ctx.from, {
            text: `⏰ Rappel programmé pour ${hh}:${mm}\n📝 "${text}"`
        }, { quoted: msg });

        console.log(`✅ [REMIND] Programmé dans ${durationStr} (${totalMs}ms)`);

        setTimeout(async () => {
            try {
                await sock.sendMessage(ctx.from, { text: `🔔 RAPPEL\n📝 ${text}` });
                console.log('✅ [REMIND] Rappel envoyé');
            } catch (e) {
                console.error('❌ [REMIND] Erreur envoi:', e.message);
            }
        }, totalMs);
    }
};
