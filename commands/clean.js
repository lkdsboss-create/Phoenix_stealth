module.exports = {
    name: 'clean',
    aliases: ['purge'],
    description: 'Vide le cache',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        botState.cacheMessages.clear();
        await sock.sendMessage(myJid, { text: "🧹 *Cache mémoire vidé !*" });
    }
};
