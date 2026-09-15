module.exports = {
    name: 'menu',
    aliases: ['help', 'aide', 'commandes'],
    description: 'Affiche le tableau de bord complet des commandes',
    async execute(sock, msg, botState, ctx) {
        const uptime = require('../core/stats').formatUptime(Date.now() - botState.START_TIME);

        const menu = `
╔══════════════════════════════╗
║  🦅 *PHOENIX STEALTH*        ║
║  Noyau actif depuis ${uptime.padEnd(11)}║
╚══════════════════════════════╝

📇 *CONTACTS*
├ \`!contacts\` — Liste les contacts
├ \`!save <nom>\` — Renommer (reply)
└ \`!contacts del <nom>\` — Supprimer

🎨 *MÉDIAS*
├ \`!sticker\` / \`!s\` — Image/vidéo → sticker
├ \`!sticker haut|centre|bas\` — Position
├ \`!sticker <texte>\` — Avec légende
└ \`!viewonce\` / \`!vv\` — Capturer un View Once

🎭 *PRÉSENCE*
├ \`!type [cible] [durée]\` — Simuler la frappe
├ \`!record [cible] [durée]\` — Simuler un vocal
└ \`!stop [cible]\` — Arrêter (list = voir actifs)

🕵️ *SURVEILLANCE*
├ \`!statut\` — Statuts non vus
├ \`!astatus\` — Dernier statut d'un contact
├ \`!online\` — Contacts en ligne
└ \`!clean\` — Vider le cache RAM

📢 *GROUPE*
├ \`!tous [message]\` — Mentionner tout le monde
├ \`!tousadmin [message]\` — Mentionner les admins
├ \`!spam <n> <texte>\` — Envoi en rafale (max 30)
└ \`!spamstop\` — Arrêter le spam

⏰ *UTILITAIRES*
├ \`!remind <durée> <texte>\` — Rappel
├ \`!ping\` — Latence réseau
├ \`!runtime\` — Durée d'activité
├ \`!stats\` — Statistiques d'usage
└ \`!ghost on|off\` — Mode fantôme

💡 _Toutes tes commandes sont supprimées automatiquement (mode fantôme)._
`.trim();

        await sock.sendMessage(ctx.from, { text: menu }, { quoted: msg });
    }
};
