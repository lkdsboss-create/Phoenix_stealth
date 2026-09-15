const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const Jimp = require('jimp');
const pino = require('pino');

module.exports = {
    name: 'sticker',
    aliases: ['s', 'stiker'],
    description: 'Convertit une image en sticker',
    async execute(sock, msg, botState, ctx) {
        console.log('🎨 [STICKER] Commande reçue');

        let imageMsg = null;
        let sourceMsg = msg;

        if (msg.message?.imageMessage) {
            imageMsg = msg.message.imageMessage;
        } else {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.imageMessage) {
                imageMsg = quoted.imageMessage;
                sourceMsg = {
                    key: {
                        remoteJid: ctx.from,
                        fromMe: false,
                        id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                        participant: msg.message.extendedTextMessage.contextInfo.participant
                    },
                    message: quoted
                };
            }
        }

        if (!imageMsg) {
            await sock.sendMessage(ctx.from, { text: '❌ Envoie une image avec la légende !sticker, ou réponds à une image avec !sticker' }, { quoted: msg });
            return;
        }

        try {
            console.log('📥 Téléchargement de l\'image...');
            const buffer = await downloadMediaMessage(
                sourceMsg,
                'buffer',
                {},
                {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: sock.updateMediaMessage
                }
            );

            console.log('🔄 Conversion en WebP...');
            const image = await Jimp.read(buffer);
            // Redimensionne pour tenir dans 512x512 sans déformer
            image.contain(512, 512);
            const stickerBuffer = await image.getBufferAsync(Jimp.MIME_WEBP);

            console.log('📤 Envoi du sticker...');
            await sock.sendMessage(ctx.from, { sticker: stickerBuffer }, { quoted: msg });
            console.log('✅ [STICKER] Envoyé');

        } catch (e) {
            console.error('❌ Erreur sticker:', e.message);
            await sock.sendMessage(ctx.from, { text: `❌ Erreur: ${e.message}` }, { quoted: msg });
        }
    }
};
