const fs = require('fs');
const path = require('path');
const os = require('os');

// ==========================================
// CONFIGURATION
// ==========================================
const ANTI_DELETE_TTL = 24 * 60 * 60 * 1000; // 24h
const MAX_CACHE_SIZE = 5000;

// Dossier d'archivage (sur Termux : ~/storage/downloads/...)
const ARCHIVE_BASE = process.env.ARCHIVE_DIR
    ? path.resolve(process.env.ARCHIVE_DIR)
    : path.join(os.homedir(), 'storage', 'downloads', 'Phoenix_Media', 'Messages_Supprimes');

const SUBFOLDERS = {
    image: 'Images',
    video: 'Videos',
    audio: 'Audios',
    sticker: 'Stickers',
    text: 'Textes'
};

// ==========================================
// CACHE
// ==========================================
const messageCache = new Map();

function cacheMessage(msg) {
    if (!msg || !msg.key || !msg.key.id) return;
    const key = `${msg.key.remoteJid}:${msg.key.id}`;
    messageCache.set(key, { msg, timestamp: Date.now() });

    if (messageCache.size > MAX_CACHE_SIZE) {
        const firstKey = messageCache.keys().next().value;
        messageCache.delete(firstKey);
    }
}

function getCachedMessage(chatId, messageId) {
    const key = `${chatId}:${messageId}`;
    const entry = messageCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ANTI_DELETE_TTL) {
        messageCache.delete(key);
        return null;
    }
    return entry.msg;
}

function cleanupCache() {
    const now = Date.now();
    for (const [key, entry] of messageCache.entries()) {
        if (now - entry.timestamp > ANTI_DELETE_TTL) {
            messageCache.delete(key);
        }
    }
}

setInterval(cleanupCache, 3600000);

// ==========================================
// ARCHIVAGE DISQUE
// ==========================================
function ensureArchiveFolders() {
    try {
        if (!fs.existsSync(ARCHIVE_BASE)) {
            fs.mkdirSync(ARCHIVE_BASE, { recursive: true });
        }
        for (const sub of Object.values(SUBFOLDERS)) {
            const folder = path.join(ARCHIVE_BASE, sub);
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
            }
        }
    } catch (e) {
        console.error('⚠️ Erreur création dossiers archive:', e.message);
    }
}

/**
 * Sauvegarde un message texte dans Textes/.
 * Retourne le chemin du fichier créé.
 */
function archiveText(content, senderName, chatName) {
    try {
        ensureArchiveFolders();
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-');
        const safeSender = String(senderName).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
        const filename = `${dateStr}_${timeStr}_${safeSender}.txt`;
        const filepath = path.join(ARCHIVE_BASE, SUBFOLDERS.text, filename);

        const fileContent = `Date : ${now.toLocaleString('fr-FR')}\n` +
                            `Expéditeur : ${senderName}\n` +
                            `Chat : ${chatName}\n` +
                            `----------------------------------------\n\n` +
                            content;

        fs.writeFileSync(filepath, fileContent, 'utf-8');
        return filepath;
    } catch (e) {
        console.error('⚠️ Erreur archivage texte:', e.message);
        return null;
    }
}

/**
 * Sauvegarde un média dans le sous-dossier correspondant.
 * Retourne le chemin du fichier créé.
 */
function archiveMedia(buffer, mediaType, senderName, chatName, ext = null) {
    try {
        ensureArchiveFolders();
        const sub = SUBFOLDERS[mediaType] || 'Autres';
        const folder = path.join(ARCHIVE_BASE, sub);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-');
        const safeSender = String(senderName).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);

        let extension = ext;
        if (!extension) {
            if (mediaType === 'image') extension = 'jpg';
            else if (mediaType === 'video') extension = 'mp4';
            else if (mediaType === 'audio') extension = 'ogg';
            else if (mediaType === 'sticker') extension = 'webp';
            else extension = 'bin';
        }

        const filename = `${dateStr}_${timeStr}_${safeSender}.${extension}`;
        const filepath = path.join(folder, filename);

        fs.writeFileSync(filepath, buffer);
        return filepath;
    } catch (e) {
        console.error('⚠️ Erreur archivage média:', e.message);
        return null;
    }
}

module.exports = {
    cacheMessage,
    getCachedMessage,
    messageCache,
    archiveText,
    archiveMedia,
    ARCHIVE_BASE
};
