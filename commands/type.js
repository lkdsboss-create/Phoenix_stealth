const { jidNormalizedUser } = require('@whiskeysockets/baileys');

module.exports = {
    name: 'type',
    aliases: ['ecrit'],
    description: 'Simule la frappe',
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

        if (botState.activeIntervals[targetJid]) clearInterval(botState.activeIntervals[targetJid]);
        try {
            await sock.sendPresenceUpdate('available', targetJid);
            await sock.sendPresenceUpdate('composing', targetJid);
        } catch (e) { }

        botState.activeIntervals[targetJid] = setInterval(async () => {
            if (botState.currentSock !== sock) {
                clearInterval(botState.activeIntervals[targetJid]);
                delete botState.activeIntervals[targetJid];
                return;
            }
            try { await sock.sendPresenceUpdate('composing', targetJid); }
            catch (err) {
                clearInterval(botState.activeIntervals[targetJid]);
                delete botState.activeIntervals[targetJid];
            }
        }, 8000);

        await sock.sendMessage(myJid, { text: `✍️ *Ghost Type activé pour :* ${targetDisplay}` });
    }
};
