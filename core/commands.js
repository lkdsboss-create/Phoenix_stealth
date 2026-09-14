const fs = require('fs');
const path = require('path');

const commands = new Map();
const commandsPath = path.join(__dirname, '../commands');

// Vérifie si le dossier existe, sinon le crée
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath);
}

const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.name && command.execute) {
        commands.set(command.name, command);
        // On enregistre aussi les alias s'il y en a
        if (command.aliases && Array.isArray(command.aliases)) {
            command.aliases.forEach(alias => commands.set(alias, command));
        }
    }
}

module.exports = commands;
