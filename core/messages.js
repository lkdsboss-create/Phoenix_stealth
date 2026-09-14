const commands = require('./commands');

const PREFIX = '!';

module.exports = async (sock, msg) => {
    try {
        // Extraction du texte (gère les messages simples et étendus)
        const messageType = Object.keys(msg.message)[0];
        let messageContent = '';

        if (messageType === 'conversation') {
            messageContent = msg.message.conversation;
        } else if (messageType === 'extendedTextMessage') {
            messageContent = msg.message.extendedTextMessage.text;
        }

        if (!messageContent.startsWith(PREFIX)) return;

        // Découpage : !dl https://lien -> commandName="dl", args=["https://lien"]
        const args = messageContent.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = commands.get(commandName);

        if (command) {
            await command.execute(sock, msg, args);
        }
    } catch (error) {
        console.error('Erreur dans le routeur de messages:', error);
    }
};
