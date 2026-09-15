module.exports = {
    name: 'spam',
    aliases: ['flood'],
    description: 'Envoie N messages',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        const n = parseInt(ctx.args[0]);
        const txt = ctx.args.slice(1).join(' ').trim();
        if (!n || !txt || n < 1 || n > 30) {
            await sock.sendMessage(myJid, { text: '❌ Usage : !spam <n> <texte> (n max 30)' });
            return;
        }
        for (let i = 0; i < n; i++) {
            await sock.sendMessage(ctx.from, { text: txt });
            await new Promise(r => setTimeout(r, 600));
        }
        await sock.sendMessage(myJid, { text: `✅ ${n} messages envoyés.` });
    }
};
