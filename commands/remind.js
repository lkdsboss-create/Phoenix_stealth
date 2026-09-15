module.exports = {
    name: 'remind',
    aliases: ['rappel', 'r'],
    description: 'Programme un rappel',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;

        if (ctx.args.length < 2) {
            await sock.sendMessage(myJid, {
                text: '❌ Usage : !remind <durée> <message>\nExemples : 30s, 10m, 1h'
            });
            return;
        }

        const durationStr = ctx.args[0].toLowerCase();
        const text = ctx.args.slice(1).join(' ');

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

        if (!matched || totalMs === 0 || totalMs > 24 * 60 * 60 * 1000) {
            await sock.sendMessage(myJid, { text: '❌ Durée invalide. Max 24h.' });
            return;
        }

        const target = new Date(Date.now() + totalMs);
        const hh = String(target.getHours()).padStart(2, '0');
        const mm = String(target.getMinutes()).padStart(2, '0');

        await sock.sendMessage(myJid, { text: `⏰ Rappel programmé pour ${hh}:${mm}\n📝 "${text}"` });

        setTimeout(async () => {
            try {
                await sock.sendMessage(myJid, { text: `🔔 RAPPEL\n📝 ${text}` });
            } catch (e) { }
        }, totalMs);
    }
};
