function formatUptime(ms) {
    const s = Math.floor((ms / 1000) % 60), m = Math.floor((ms / (1000 * 60)) % 60);
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24), d = Math.floor(ms / (1000 * 60 * 60 * 24));
    return `${d}d ${h}h ${m}m ${s}s`;
}

module.exports = {
    name: 'runtime',
    aliases: ['uptime'],
    description: 'Durée d\'activité',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        await sock.sendMessage(myJid, { text: `⏱️ *Actif depuis :*\n\`${formatUptime(Date.now() - botState.START_TIME)}\`` });
    }
};
