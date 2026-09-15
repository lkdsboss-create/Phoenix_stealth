module.exports = {
    name: 'ping',
    aliases: ['p'],
    description: 'Latence',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        const latence = Date.now() - (msg.messageTimestamp * 1000 || Date.now());
        await sock.sendMessage(myJid, { text: `🏓 *Pong !*\n⚡ Latence : \`${latence}ms\`\n🦅 *Phoenix Modulaire*` });
    }
};
