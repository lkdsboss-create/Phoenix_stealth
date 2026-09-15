module.exports = {
    name: 'tous',
    aliases: ['tagall', 'everyone', 'all'],
    description: 'Mentionne tous les membres du groupe',
    async execute(sock, msg, botState, ctx) {
        if (!ctx.isGroup) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Cette commande ne fonctionne que dans un groupe.'
            }, { quoted: msg });
            return;
        }

        const customMessage = ctx.args.join(' ').trim();

        try {
            const metadata = await sock.groupMetadata(ctx.from);
            const participants = metadata?.participants || [];

            if (participants.length === 0) {
                await sock.sendMessage(ctx.from, {
                    text: '❌ Impossible de récupérer les membres.'
                }, { quoted: msg });
                return;
            }

            // Filtre les JID valides
            const mentions = participants
                .map(p => p.id || p.jid)
                .filter(jid => jid && (jid.includes('@s.whatsapp.net') || jid.includes('@lid')));

            if (mentions.length === 0) {
                await sock.sendMessage(ctx.from, {
                    text: '❌ Aucun membre mentionnable.'
                }, { quoted: msg });
                return;
            }

            // Construction du message
            const header = customMessage || 'Notification générale';
            let text = `📢 *${header}*\n\n`;

            for (const jid of mentions) {
                const num = jid.split('@')[0].split(':')[0];
                text += `@${num}\n`;
            }

            console.log(`📢 [TOUS] ${mentions.length} mention(s) dans "${metadata.subject || '?'}"`);

            await sock.sendMessage(ctx.from, {
                text: text.trim(),
                mentions
            }, { quoted: msg });

        } catch (e) {
            console.error('❌ [TOUS] Erreur:', e.message);
            await sock.sendMessage(ctx.from, {
                text: `❌ Erreur: ${e.message}`
            }, { quoted: msg });
        }
    }
};
