module.exports = {
    name: 'setnom',
    aliases: ['renommer'],
    description: 'Force un nom de contact',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        if (ctx.args.length >= 2) {
            const num = ctx.args[0].replace(/[^0-9]/g, '');
            const targetJid = `${num}@s.whatsapp.net`;
            const assignedName = ctx.args.slice(1).join(' ');
            botState.contactNames[targetJid] = assignedName;
            try {
                const fs = require('fs');
                fs.writeFileSync(botState.NAMES_FILE, JSON.stringify(botState.contactNames, null, 2));
            } catch (e) { }
            await sock.sendMessage(myJid, { text: `✅ Ce numéro s'affichera comme "${assignedName}".` });
        }
    }
};
