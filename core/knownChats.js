const fs = require('fs');
const path = require('path');

const KNOWN_FILE = path.join(__dirname, '..', 'Phoenix_Media', 'known_chats.json');

let knownChats = new Set();
let saveTimer = null;

function loadKnownChats() {
    try {
        if (fs.existsSync(KNOWN_FILE)) {
            const raw = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf-8'));
            knownChats = new Set(raw);
            console.log(`💬 [KNOWN] ${knownChats.size} contact(s) avec qui tu as discuté`);
        }
    } catch (e) {
        console.error('⚠️ Erreur chargement known_chats:', e.message);
        knownChats = new Set();
    }
}

function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(KNOWN_FILE, JSON.stringify([...knownChats], null, 2));
        } catch (e) { }
    }, 3000);
}

/**
 * Enregistre un JID comme "contact connu" (a déjà discuté).
 * Ignore les groupes et les status.
 */
function markAsKnown(jid) {
    if (!jid) return;
    if (jid.endsWith('@g.us')) return;         // Ignore les groupes
    if (jid === 'status@broadcast') return;    // Ignore les statuts
    if (knownChats.has(jid)) return;

    knownChats.add(jid);
    scheduleSave();
}

function isKnown(jid) {
    return knownChats.has(jid);
}

function getAllKnown() {
    return [...knownChats];
}

module.exports = { loadKnownChats, markAsKnown, isKnown, getAllKnown, knownChats: () => knownChats };
