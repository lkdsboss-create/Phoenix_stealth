module.exports = {
    name: 'ping',
    aliases: ['p'],
    description: 'Test de latence',
    execute: async (sock, msg, args) => {
        const chatId = msg.key.remoteJid;
        await sock.sendMessage(chatId, { text: 'Pong! 🏓' }, { quoted: msg });
    }
};

