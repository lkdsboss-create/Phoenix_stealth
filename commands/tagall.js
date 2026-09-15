module.exports = {
    name: 'tagall',
    aliases: ['tous', 'everyone', 'all'],
    description: 'Mentionne tous les membres du groupe',
    async execute(sock, msg, botState, ctx) {
        console.log('📢 [TAGALL] Commande reçue | isGroup:', ctx.isGroup, '| from:', ctx.from);

        if (!ctx.isGroup) {
            console.log('🚫 [TAGALL] Refusé : pas un groupe');
            await sock.sendMessage(ctx.from, {
                text: '❌ Cette commande fonctionne uniquement dans un groupe.'
            }, { quoted: msg });
            return;
        }

        const customMessage = ctx.args.join(' ').trim();

        try {
            const groupMetadata = await sock.groupMetadata(ctx.from);
            const participants = groupMetadata?.participants || [];

            console.log(`📢 [TAGALL] Groupe : ${groupMetadata?.subject || '?'}`);
            console.log(`📢 [TAGALL] Participants bruts : ${participants.length}`);

            // Log détaillé pour comprendre le format des JID
            participants.slice(0, 3).forEach((p, i) => {
                console.log(`   [${i}] id=${p.id} | jid=${p.jid} | lid=${p.lid} | admin=${p.admin || 'no'}`);
            });

            if (participants.length === 0) {
                console.log('🚫 [TAGALL] Aucun participant');
                await sock.sendMessage(ctx.from, {
                    text: '❌ Aucun membre trouvé dans ce groupe.'
                }, { quoted: msg });
                return;
            }

            // ✅ Accepte les deux formats : @s.whatsapp.net ET @lid
            const mentions = participants
                .map(p => p.id || p.jid || p.lid)
                .filter(jid => jid && (
                    jid.includes('@s.whatsapp.net') ||
                    jid.includes('@lid') ||
                    jid.includes('@c.us')
                ));

            console.log(`📢 [TAGALL] Mentions valides : ${mentions.length}/${participants.length}`);

            if (mentions.length === 0) {
                console.log('🚫 [TAGALL] Aucun JID mentionnable');
                await sock.sendMessage(ctx.from, {
                    text: '❌ Aucun membre mentionnable (format JID non supporté).'
                }, { quoted: msg });
                return;
            }

            // ==========================================
            // CONSTRUCTION DU MESSAGE
            // ==========================================
            let text = customMessage
                ? `📢 ${customMessage}\n\n`
                : '📢 Notification générale\n\n';

            for (const jid of mentions) {
                const number = jid.split('@')[0];
                text += `@${number}\n`;
            }

            console.log(`📢 [TAGALL] Envoi avec ${mentions.length} mention(s)`);

            await sock.sendMessage(ctx.from, {
                text: text.trim(),
                mentions: mentions
            }, { quoted: msg });

            console.log('✅ [TAGALL] Envoyé');

        } catch (e) {
            console.error('❌ [TAGALL] Erreur:', e.message);
            await sock.sendMessage(ctx.from, {
                text: `❌ Erreur: ${e.message}`
            }, { quoted: msg });
        }
    }
};
