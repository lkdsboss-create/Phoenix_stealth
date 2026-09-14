const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const messageHandler = require('./core/messages');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // On envoie le message au gestionnaire
        await messageHandler(sock, msg);
    });
}

startBot();
