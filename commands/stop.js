const { jidNormalizedUser } = require('toxic-baileys');

module.exports = {
    name: 'stop',
    aliases: ['arrete'],
    description: 'Arrête les simulations',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${botState.PHONE_NUMBER}@s.whatsapp.net`;
        const arg = ctx.args.join(' ').trim();
        let targetJid = ctx.from;
        let targetDisplay = "Inconnu";

        if (arg) targetJid = `${arg.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        targetJid = jidNormalizedUser(targetJid);

        if (botState.contactNames[targetJid]) targetDisplay = botState.contactNames[targetJid];
        else if (targetJid.endsWith('@g.us')) {
            try { targetDisplay = (await sock.groupMetadata(targetJid)).subject; } catch { targetDisplay = "Ce Groupe"; }
        } else targetDisplay = targetJid.split('@')[0];

        if (botState.activeIntervals[targetJid]) {
            clearInterval(botState.activeIntervals[targetJid]);
            delete botState.activeIntervals[targetJid];
        }
        try { await sock.sendPresenceUpdate('paused', targetJid); } catch (e) { }

        await sock.sendMessage(myJid, { text: `🛑 *Simulations arrêtées pour :* ${targetDisplay}` });
    }
};
