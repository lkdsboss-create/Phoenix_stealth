module.exports = {
    name: 'ping',
    aliases: ['p', 'latency'],
    description: 'Calcule la latence réseau',
    async execute(sock, msg, botState, ctx) {
        const start = Date.now();

        // Envoie un message vide "react" pour mesurer l'aller-retour
        try {
            await sock.sendMessage(ctx.from, { text: '🏓' }, { quoted: msg });
            const latency = Date.now() - start;

            // Évalue la qualité
            let quality = '🟢 Excellente';
            if (latency > 200) quality = '🟡 Correcte';
            if (latency > 800) quality = '🟠 Lente';
            if (latency > 2000) quality = '🔴 Très lente';

            await sock.sendMessage(ctx.from, {
                text: `⚡ *Pong !*\n\n` +
                      `📡 Latence : *${latency} ms*\n` +
                      `📶 Qualité : ${quality}\n` +
                      `🔌 Socket : ${sock.ws?.readyState === 1 ? 'Connecté ✅' : 'Déconnecté ❌'}`
            }, { quoted: msg });
        } catch (e) {
            await sock.sendMessage(ctx.from, {
                text: `❌ Erreur : ${e.message}`
            }, { quoted: msg });
        }
    }
};
