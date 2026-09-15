const { handleCommand } = require('./commands');
const { captureContact, captureGroup } = require('./contacts');
const { scheduleGhostDelete } = require('./ghost');
const { incrementMessagesReceived, incrementCommand } = require('./stats');

const OWNER_NUMBER = process.env.OWNER_NUMBER || '22896081989';
const PREFIX = '!';
const STICKER_COMMANDS = ['sticker', 's', 'stiker', 'stikervideo', 'sv'];
const MEDIA_CACHE_TTL = 60 * 1000;
const GHOST_EXEMPT = ['ghost', 'menu', 'stats'];

async function handleMessages(sock, m, botState) {
    if (m.type !== 'notify') return;

    for (const msg of m.messages) {
        if (!msg || !msg.message) continue;
        try {
            incrementMessagesReceived();
            await processSingleMessage(sock, msg, botState);
        } catch (e) {
            console.error('⚠️ Erreur traitement message:', e.message);
        }
    }
}

async function processSingleMessage(sock, msg, botState) {
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

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = isGroup ? msg.key.participant : from;
    const isFromMe = msg.key.fromMe;
    const senderNumber = sender ? sender.split('@')[0].split(':')[0] : '';

    // Capture contacts
    if (isGroup) {
        if (!botState.capturedGroups) botState.capturedGroups = new Set();
        if (!botState.capturedGroups.has(from)) {
            try {
                const metadata = await sock.groupMetadata(from);
                if (metadata?.subject) {
                    captureGroup(from, metadata.subject);
                    botState.capturedGroups.add(from);
                }
            } catch (e) {}
        }
        if (sender && msg.pushName) captureContact(sender, msg.pushName);
    } else if (!isFromMe && msg.pushName) {
        captureContact(sender, msg.pushName);
    }

    const isOwner = isFromMe || senderNumber === OWNER_NUMBER;
    if (!isOwner) return;

    if (msg.key.id) botState.cacheMessages.set(msg.key.id, msg);

    const hasMedia = messageType === 'imageMessage' || messageType === 'videoMessage';

    if (hasMedia) {
        cacheMedia(botState, senderNumber, msg);
        if (!text) return;
    }

    if (!text || !text.startsWith(PREFIX)) return;

    const args = text.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    // Compteur statistiques
    incrementCommand(commandName);

    // Mode fantôme
    const isExempt = GHOST_EXEMPT.includes(commandName);
    if (!isExempt) {
        scheduleGhostDelete(sock, msg, commandName);
    }

    if (STICKER_COMMANDS.includes(commandName) && !hasMedia) {
        const cached = getRecentMedia(botState, senderNumber);
        if (cached.length > 0) {
            console.log(`📦 ${cached.length} média(s) en cache → traitement`);
            for (const cachedMsg of cached) {
                await handleCommand(sock, cachedMsg, botState, {
                    from, sender, senderNumber, isGroup, isFromMe, isOwner,
                    commandName, args, text
                });
                await new Promise(r => setTimeout(r, 1000));
            }
            botState.recentMedia.set(senderNumber, []);
            return;
        }
    }

    console.log(`🥷 Commande propriétaire : "${commandName}" | args: [${args.join(', ')}]`);

    await handleCommand(sock, msg, botState, {
        from, sender, senderNumber, isGroup, isFromMe, isOwner,
        commandName, args, text
    });
}

function cacheMedia(botState, senderNumber, msg) {
    if (!botState.recentMedia) botState.recentMedia = new Map();
    if (!botState.recentMedia.has(senderNumber)) {
        botState.recentMedia.set(senderNumber, []);
    }
    const list = botState.recentMedia.get(senderNumber);
    list.push({ msg, timestamp: Date.now() });

    const cutoff = Date.now() - MEDIA_CACHE_TTL;
    botState.recentMedia.set(senderNumber, list.filter(m => m.timestamp > cutoff));
}

function getRecentMedia(botState, senderNumber) {
    if (!botState.recentMedia) botState.recentMedia = new Map();
    const list = botState.recentMedia.get(senderNumber) || [];
    const cutoff = Date.now() - MEDIA_CACHE_TTL;
    return list.filter(m => m.timestamp > cutoff).map(m => m.msg);
}

function handleReceipts(events, botState) {}

module.exports = { handleMessages, handleReceipts };
