const { messageCache } = require('../core/antiDelete');

module.exports = {
    name: 'clean',
    aliases: ['clearcache', 'purge'],
    description: 'Vide le cache RAM des messages archivés',
    async execute(sock, msg, botState, ctx) {
        const before = messageCache.size;
        messageCache.clear();
        await sock.sendMessage(ctx.from, {
            text: `🧹 Cache vidé : ${before} message(s) supprimé(s) de la RAM.`
        }, { quoted: msg });
    }
};
