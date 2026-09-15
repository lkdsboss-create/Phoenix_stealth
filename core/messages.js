const { handleCommand } = require('./commands');

// ✅ TON NUMÉRO (format international sans +)
const OWNER_NUMBER = process.env.OWNER_NUMBER || '22896081989';

async function handleMessages(sock, m, botState) {
    const msg = m.messages[0];
    if (!msg || !msg.message) return;

    // Extraction du texte
    const messageType = Object.keys(msg.message)[0];
    let text = '';

    if (messageType === 'conversation') {
        text = msg.message.conversation;
    } else if (messageType === 'extendedTextMessage') {
        text = msg.message.extendedTextMessage.text;
    } else if (messageType === 'imageMessage' && msg.message.imageMessage.caption) {
        text = msg.message.imageMessage.caption;
    } else if (messageType === 'videoMessage' && msg.message.videoMessage.caption) {
        text = msg.message.videoMessage.caption;
    }

    if (!text) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = isGroup ? msg.key.participant : from;
    const isFromMe = msg.key.fromMe;
    const senderNumber = sender ? sender.split('@')[0].split(':')[0] : '';

    // ✅ SEUL TOI PEUX DÉCLENCHER LE BOT
    const isOwner = isFromMe || senderNumber === OWNER_NUMBER;

    // 🚫 MODE FANTÔME : On ignore TOUT ce qui ne vient pas de toi
    // (aucun log, aucune réponse, aucune trace)
    if (!isOwner) return;

    // Mise en cache des messages du propriétaire uniquement (nécessaire pour reply)
    if (msg.key.id) botState.cacheMessages.set(msg.key.id, msg);

    // Détection du préfixe (invisible aux yeux des autres)
    const PREFIX = '!';
    if (!text.startsWith(PREFIX)) return;

    const args = text.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    // Log interne (visible que dans TON Termux)
    console.log(`🥷 Commande propriétaire : "${commandName}" | args: [${args.join(', ')}]`);

    await handleCommand(sock, msg, botState, {
        from,
        sender,
        senderNumber,
        isGroup,
        isFromMe,
        isOwner,
        commandName,
        args,
        text
    });
}

function handleReceipts(events, botState) {
    // Vide : on ne réagit à RIEN (pas d'accusé de lecture, pas de "typing")
}

module.exports = { handleMessages, handleReceipts };
