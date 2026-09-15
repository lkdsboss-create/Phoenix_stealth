module.exports = {
    name: 'menu',
    aliases: ['help', 'aide'],
    description: 'Menu des commandes',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        const mText = `🦅 *PHOENIX CONTROL HUB v5.4.6* 🦅\n\n` +
            `⚡ *COMMANDES :*\n` +
            `• \`!statut\` ➜ Statuts non lus.\n` +
            `• \`!statut [nom]\` ➜ Statuts d'un contact.\n` +
            `• \`!type [n°]\` ➜ Simule "Écrit...".\n` +
            `• \`!record [n°]\` ➜ Simule un vocal.\n` +
            `• \`!stop [n°]\` ➜ Arrête toute simulation.\n` +
            `• \`!tous [texte]\` ➜ Mentionne tout le monde.\n` +
            `• \`!spam [n] [texte]\` ➜ Envoie [n] messages.\n` +
            `• \`!setnom [n°] [nom]\` ➜ Force un nom.\n` +
            `• \`!ping\` ➜ Latence.\n` +
            `• \`!runtime\` ➜ Temps d'activité.\n` +
            `• \`!clean\` ➜ Libère la RAM.\n\n` +
            `📁 *Stockage :*\n\`${botState.LOCAL_DIR}\``;
        await sock.sendMessage(myJid, { text: mText });
    }
};
