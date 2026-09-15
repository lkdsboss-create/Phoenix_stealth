const { getAllContacts, deleteContactByName } = require('../core/contacts');

module.exports = {
    name: 'contacts',
    aliases: ['liste', 'carnet'],
    description: 'Liste ou supprime les contacts mémorisés',
    async execute(sock, msg, botState, ctx) {
        const subCmd = ctx.args[0]?.toLowerCase();

        // ==========================================
        // Suppression : !contacts del <nom>
        // ==========================================
        if (subCmd === 'del' || subCmd === 'supprimer') {
            const name = ctx.args.slice(1).join(' ').trim();
            if (!name) {
                await sock.sendMessage(ctx.from, {
                    text: '❌ Usage : `!contacts del <nom>`'
                }, { quoted: msg });
                return;
            }
            const deleted = deleteContactByName(name);
            if (deleted.length === 0) {
                await sock.sendMessage(ctx.from, {
                    text: `❌ Aucun contact contenant "${name}"`
                }, { quoted: msg });
            } else {
                const list = deleted.map(d => `• ${d.name}`).join('\n');
                await sock.sendMessage(ctx.from, {
                    text: `✅ Supprimés :\n${list}`
                }, { quoted: msg });
            }
            return;
        }

        // ==========================================
        // Liste : !contacts
        // ==========================================
        const all = getAllContacts();
        if (all.length === 0) {
            await sock.sendMessage(ctx.from, {
                text: '📭 Aucun contact mémorisé pour le moment.'
            }, { quoted: msg });
            return;
        }

        let text = `📇 *Contacts mémorisés (${all.length})*\n\n`;
        for (const c of all.slice(0, 50)) {
            const num = c.jid.split('@')[0].split(':')[0];
            text += `• ${c.name} — ${num}\n`;
        }
        if (all.length > 50) {
            text += `\n… et ${all.length - 50} autres.`;
        }

        await sock.sendMessage(ctx.from, { text }, { quoted: msg });
    }
};
