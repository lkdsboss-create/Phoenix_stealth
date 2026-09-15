const { setContactName, getContactName } = require('../core/contacts');

module.exports = {
    name: 'save',
    aliases: ['renommer', 'setname'],
    description: 'Associe un nom personnalisé à un contact',
    async execute(sock, msg, botState, ctx) {
        const quoted = msg.message?.extendedTextMessage?.contextInfo;
        const newName = ctx.args.join(' ').trim();

        if (!newName) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Usage : réponds à un message avec `!save <nom>`'
            }, { quoted: msg });
            return;
        }

        // Cible : l'expéditeur du message cité, ou celui qui a écrit dans le chat
        const targetJid = quoted?.participant || ctx.from;

        if (!targetJid) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Impossible de déterminer le contact.'
            }, { quoted: msg });
            return;
        }

        const oldName = getContactName(targetJid);
        setContactName(targetJid, newName);

        await sock.sendMessage(ctx.from, {
            text: `✅ Contact renommé :\n` +
                  `📛 Avant : ${oldName}\n` +
                  `✨ Après : ${newName}`
        }, { quoted: msg });
    }
};
