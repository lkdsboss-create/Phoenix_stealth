const fs = require('fs');
const path = require('path');

const commands = new Map();

function loadCommands() {
    const commandsDir = path.join(__dirname, '..', 'commands');
    if (!fs.existsSync(commandsDir)) {
        console.warn('⚠️ Dossier commands introuvable :', commandsDir);
        return;
    }

    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));

    for (const file of files) {
        try {
            const cmd = require(path.join(commandsDir, file));
            if (cmd.name && typeof cmd.execute === 'function') {
                commands.set(cmd.name.toLowerCase(), cmd);
                if (Array.isArray(cmd.aliases)) {
                    cmd.aliases.forEach(alias => commands.set(alias.toLowerCase(), cmd));
                }
            }
        } catch (e) {
            console.error(`❌ Erreur chargement ${file}:`, e.message);
        }
    }

    // Compter uniquement les commandes uniques (sans les alias)
    const uniqueCommands = new Set();
    for (const cmd of commands.values()) {
        uniqueCommands.add(cmd);
    }

    // Afficher en détail
    const cmdList = [...uniqueCommands].map(c => c.name).join(', ');
    console.log(`🥷 ${uniqueCommands.size} commande(s) chargée(s) : ${cmdList}`);
}

loadCommands();

async function handleCommand(sock, msg, botState, ctx) {
    // ✅ Triple sécurité : propriétaire uniquement
    if (!ctx.isOwner) return;

    const cmd = commands.get(ctx.commandName);
    if (!cmd) return; // Commande inconnue → silence total

    try {
        await cmd.execute(sock, msg, botState, ctx);
    } catch (e) {
        // ⚠️ On n'envoie AUCUN message d'erreur (pour ne pas trahir le bot)
        console.error(`🔥 Erreur silencieuse [${ctx.commandName}]:`, e.message);
    }
}

module.exports = { handleCommand, commands };
