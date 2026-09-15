const fs = require('fs');
const path = require('path');

const CONTACTS_FILE = path.join(__dirname, '..', 'Phoenix_Media', 'contacts_names.json');

let contacts = {};
let saveTimer = null;

function loadContacts() {
    try {
        if (!fs.existsSync(path.dirname(CONTACTS_FILE))) {
            fs.mkdirSync(path.dirname(CONTACTS_FILE), { recursive: true });
        }
        if (fs.existsSync(CONTACTS_FILE)) {
            const raw = fs.readFileSync(CONTACTS_FILE, 'utf-8');
            contacts = JSON.parse(raw);

            // Nettoyage : retire les entrées vides ou les LID
            let cleaned = 0;
            for (const [jid, name] of Object.entries(contacts)) {
                const cleanName = String(name).trim();
                if (!cleanName || cleanName === '.' || /^\d{14,}$/.test(cleanName)) {
                    delete contacts[jid];
                    cleaned++;
                }
            }
            if (cleaned > 0) {
                fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
                console.log(`🧹 ${cleaned} entrée(s) invalide(s) supprimée(s)`);
            }

            console.log(`📇 Contacts chargés : ${Object.keys(contacts).length}`);
        }
    } catch (e) {
        console.error('⚠️ Erreur chargement contacts:', e.message);
        contacts = {};
    }
}

function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
            saveTimer = null;
        } catch (e) {
            console.error('⚠️ Erreur sauvegarde contacts:', e.message);
        }
    }, 2000);
}

function extractNumber(jid) {
    if (!jid) return '';
    return String(jid).split('@')[0].split(':')[0];
}

function isLid(jid) {
    return jid && jid.endsWith('@lid');
}

function isRealNumber(num) {
    // Un vrai numéro WhatsApp fait entre 7 et 15 chiffres
    return num && /^\d{7,15}$/.test(num) && !num.startsWith('0');
}

function getContactName(jid) {
    if (!jid) return 'Inconnu';
    const num = extractNumber(jid);

    if (jid.endsWith('@g.us')) {
        return contacts[jid] || `Groupe ${num}`;
    }

    return contacts[jid] || contacts[num + '@s.whatsapp.net'] || num || 'Inconnu';
}

function setContactName(jid, name) {
    if (!jid || !name) return;
    const cleanName = String(name).trim();
    if (cleanName.length === 0) return;
    contacts[jid] = cleanName;
    scheduleSave();
}

function captureContact(jid, pushName) {
    if (!jid || !pushName) return;
    if (jid.endsWith('@g.us')) return;

    // ❌ Ignore les LID
    if (isLid(jid)) return;

    // ❌ Ignore les numéros qui ne sont pas réels
    const num = extractNumber(jid);
    if (!isRealNumber(num)) return;

    // ❌ Ignore les noms vides ou trop bizarres
    const cleanName = String(pushName).trim();
    if (cleanName.length < 2) return;
    if (cleanName === '.' || /^\d+$/.test(cleanName)) return;

    if (contacts[jid]) return;
    contacts[jid] = cleanName;
    scheduleSave();
}

function captureGroup(jid, subject) {
    if (!jid || !subject) return;
    if (!jid.endsWith('@g.us')) return;
    if (contacts[jid]) return;
    const cleanSubject = String(subject).trim();
    if (cleanSubject.length < 2) return;
    contacts[jid] = cleanSubject;
    scheduleSave();
}

function getAllContacts() {
    const list = [];
    for (const [jid, name] of Object.entries(contacts)) {
        if (isLid(jid)) continue; // Filtrer les LID à l'affichage
        list.push({ jid, name });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
}

function deleteContactByName(name) {
    const search = String(name).toLowerCase();
    const found = [];
    for (const [jid, n] of Object.entries(contacts)) {
        if (n.toLowerCase().includes(search)) {
            found.push({ jid, name: n });
            delete contacts[jid];
        }
    }
    if (found.length > 0) scheduleSave();
    return found;
}

module.exports = {
    loadContacts,
    getContactName,
    setContactName,
    captureContact,
    captureGroup,
    getAllContacts,
    deleteContactByName,
    extractNumber,
    isLid,
    contacts: () => contacts
};
