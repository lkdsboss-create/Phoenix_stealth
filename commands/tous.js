const { jidNormalizedUser } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'tous',
    aliases: ['tagall'],
    description: 'Mentionne tout le monde',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        if (!ctx.isGroup) {
            await sock.sendMessage(myJid, { text: '❌ Commande de groupe uniquement.' });
            return;
        }

        try {
            const metadata = await sock.groupMetadata(ctx.from);
            const customMsg = ctx.args.join(' ').trim();

            let txt = `📢 *TAG GLOBAL* :\n`;
            if (customMsg) txt += `\n${customMsg}\n\n`;
            else txt += `\n`;

            metadata.participants.forEach((p, i) => { txt += `${i + 1}. @${p.id.split('@')[0]}\n`; });

            await sock.sendMessage(ctx.from, {
                text: txt,
                mentions: metadata.participants.map(p => p.id)
            }, { quoted: msg });
        } catch (e) { }
    }
};
