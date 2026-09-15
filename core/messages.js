const { handleCommand } = require('./commands');

const OWNER_NUMBER = process.env.OWNER_NUMBER || '22896081989';
const PREFIX = '!';
const STICKER_COMMANDS = ['sticker', 's', 'stiker', 'stikervideo', 'sv'];
const MEDIA_CACHE_TTL = 60 * 1000; // 60 secondes

async function handleMessages(sock, m, botState) {
    if (m.type !== 'notify') return;

    for (let i = 0; i < m.messages.length; i++) {
        const msg = m.messages[i];
        if (!msg || !msg.message) continue;

        try {
            await processSingleMessage(sock, msg, botState);
        } catch (e) {
            console.error('⚠️ Erreur traitement message:', e.message);
        }

        if (i < m.messages.length - 1) {
            await new Promise(r => setTimeout(r, 300));
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

    const isOwner = isFromMe || senderNumber === OWNER_NUMBER;

    // Cache général des messages (pour reply)
    if (msg.key.id) botState.cacheMessages.set(msg.key.id, msg);

    // ==========================================
    // 1. CACHE DES MÉDIAS (albums + médias isolés)
    // ==========================================
    const hasMedia = messageType === 'imageMessage' || messageType === 'videoMessage';

    if (hasMedia) {
        // Détection d'album : WhatsApp attache un parentMessageKey commun
        const assoc = msg.message.messageContextInfo?.messageAssociation;
        const albumParentId = assoc?.parentMessageKey?.id || null;

        if (albumParentId) {
            // 📦 C'est une photo/vidéo d'album
            const album = botState.albumCache.get(albumParentId) || {
                messages: [],
                timestamp: Date.now(),
                from: from,
                senderNumber: senderNumber,
                isFromMe: isFromMe,
                isOwner: isOwner,
                isGroup: isGroup
            };
            album.messages.push(msg);
            album.timestamp = Date.now();
            botState.albumCache.set(albumParentId, album);

            console.log(`📦 Album [${albumParentId.slice(0, 8)}...] : +1 (${album.messages.length} total)`);
        } else {
            // 🖼️ Média isolé
            cacheMedia(botState, senderNumber, msg);
        }

        // Si pas de légende, on s'arrête là
        if (!text) return;
    }

    // ==========================================
    // 2. COMMANDES (propriétaire uniquement)
    // ==========================================
    if (!isOwner) return;
    if (!text || !text.startsWith(PREFIX)) return;

    const args = text.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    // ==========================================
    // 3. COMMANDE STICKER SANS MÉDIA ATTACHÉ
    // ==========================================
    if (STICKER_COMMANDS.includes(commandName) && !hasMedia) {
        // Cas A : la commande est une réponse à un message
        const quotedKey = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;

        if (quotedKey) {
            // Cherche l'album qui contient ce message cité
            let foundAlbum = null;
            let foundAlbumId = null;

            for (const [albumId, album] of botState.albumCache.entries()) {
                if (album.messages.some(m => m.key.id === quotedKey)) {
                    foundAlbum = album;
                    foundAlbumId = albumId;
                    break;
                }
            }

            if (foundAlbum) {
                console.log(`📦 Réponse à un album → traitement des ${foundAlbum.messages.length} médias`);
                for (const albumMsg of foundAlbum.messages) {
                    await handleCommand(sock, albumMsg, botState, {
                        from, sender, senderNumber, isGroup, isFromMe, isOwner,
                        commandName, args, text
                    });
                    await new Promise(r => setTimeout(r, 1000));
                }
                botState.albumCache.delete(foundAlbumId);
                return;
            }
        }

        // Cas B : médias récents du propriétaire (envoyés juste avant)
        const cached = getRecentMedia(botState, senderNumber);
        if (cached.length > 0) {
            console.log(`📦 ${cached.length} média(s) récent(s) → traitement`);
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

        // Cas C : albums récents reçus par le propriétaire
        const recentAlbums = getRecentAlbums(botState, senderNumber);
        if (recentAlbums.length > 0) {
            console.log(`📦 ${recentAlbums.length} album(s) récent(s) → traitement`);
            for (const album of recentAlbums) {
                for (const albumMsg of album.messages) {
                    await handleCommand(sock, albumMsg, botState, {
                        from, sender, senderNumber, isGroup, isFromMe, isOwner,
                        commandName, args, text
                    });
                    await new Promise(r => setTimeout(r, 1000));
                }
                botState.albumCache.delete(album.id);
            }
            return;
        }
    }

    // ==========================================
    // 4. COMMANDE NORMALE
    // ==========================================
    console.log(`🥷 Commande propriétaire : "${commandName}" | args: [${args.join(', ')}]`);

    await handleCommand(sock, msg, botState, {
        from, sender, senderNumber, isGroup, isFromMe, isOwner,
        commandName, args, text
    });
}

// ==========================================
// GESTION DES CACHES
// ==========================================
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

function getRecentAlbums(botState, senderNumber) {
    if (!botState.albumCache) botState.albumCache = new Map();
    const cutoff = Date.now() - MEDIA_CACHE_TTL;
    const results = [];
    for (const [albumId, album] of botState.albumCache.entries()) {
        // Un album est "récent" s'il est dans la fenêtre TTL et que le propriétaire y a accès
        if (album.timestamp > cutoff) {
            // Si le propriétaire est l'expéditeur ou le destinataire
            if (album.senderNumber === senderNumber || album.isFromMe || album.from === senderNumber + '@s.whatsapp.net') {
                results.push({ id: albumId, ...album });
            }
        }
    }
    // Trie par timestamp décroissant (plus récent en premier)
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results;
}

// Nettoyage périodique des caches
setInterval(() => {
    const cutoff = Date.now() - MEDIA_CACHE_TTL;
    const botStateGlobal = global.botState;
    if (botStateGlobal?.albumCache) {
        for (const [id, album] of botStateGlobal.albumCache.entries()) {
            if (album.timestamp < cutoff) botStateGlobal.albumCache.delete(id);
        }
    }
}, 30000);

function handleReceipts(events, botState) {}

module.exports = { handleMessages, handleReceipts };
