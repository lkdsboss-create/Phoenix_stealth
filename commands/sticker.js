const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Jimp } = require('jimp');
const pino = require('pino');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
    name: 'sticker',
    aliases: ['s', 'stiker', 'stikervideo', 'sv'],
    description: 'Convertit image/vidéo en sticker (avec légende optionnelle)',
    async execute(sock, msg, botState, ctx) {
        console.log('🎨 [STICKER] args:', ctx.args);

        // La légende est le texte après "!sticker"
        const caption = ctx.args.join(' ').trim();

        // Détection image ou vidéo
        let mediaMsg = null;
        let mediaType = null; // 'image' ou 'video'
        let sourceMsg = msg;

        if (msg.message?.imageMessage) {
            mediaMsg = msg.message.imageMessage;
            mediaType = 'image';
        } else if (msg.message?.videoMessage) {
            mediaMsg = msg.message.videoMessage;
            mediaType = 'video';
        } else {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.imageMessage) {
                mediaMsg = quoted.imageMessage;
                mediaType = 'image';
                sourceMsg = buildQuotedSource(msg, quoted, ctx);
            } else if (quoted?.videoMessage) {
                mediaMsg = quoted.videoMessage;
                mediaType = 'video';
                sourceMsg = buildQuotedSource(msg, quoted, ctx);
            }
        }

        if (!mediaMsg) {
            await sock.sendMessage(ctx.from, {
                text: '❌ Envoie une image ou vidéo avec la légende !sticker [texte optionnel]\nOu réponds à un média avec !sticker [texte]'
            }, { quoted: msg });
            return;
        }

        // WhatsApp refuse les légendes sur les stickers animés
        const finalCaption = mediaType === 'video' ? '' : caption;

        const tmpId = Date.now();
        const tmpInput = path.join(os.tmpdir(), `stick_${tmpId}`);
        const tmpPng = path.join(os.tmpdir(), `stick_${tmpId}.png`);
        const tmpWebp = path.join(os.tmpdir(), `stick_${tmpId}.webp`);

        try {
            // ==========================================
            // 1. TÉLÉCHARGEMENT
            // ==========================================
            console.log('📥 Téléchargement...');
            const buffer = await downloadMediaMessage(
                sourceMsg,
                'buffer',
                {},
                {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: sock.updateMediaMessage
                }
            );

            if (mediaType === 'image') {
                // ==========================================
                // IMAGE → STICKER (avec légende optionnelle)
                // ==========================================
                console.log('🖼️ Traitement image...');
                const image = await Jimp.fromBuffer(buffer);
                image.contain({ w: 512, h: 512 });

                // Ajout de la légende si fournie
                if (finalCaption) {
                    console.log('✏️ Ajout de la légende :', finalCaption);
                    await addCaption(image, finalCaption);
                }

                // Jimp ne sait pas écrire en WebP → PNG puis ffmpeg
                const pngBuffer = await image.getBuffer('image/png');
                fs.writeFileSync(tmpPng, pngBuffer);

                console.log('🎨 Conversion PNG → WebP...');
                execSync(
                    `ffmpeg -y -i "${tmpPng}" -vcodec libwebp -lossless 0 -q:v 80 -preset default -an -vsync 0 "${tmpWebp}"`,
                    { stdio: 'ignore' }
                );

            } else {
                // ==========================================
                // VIDÉO → STICKER ANIMÉ
                // ==========================================
                console.log('🎬 Traitement vidéo...');
                const videoPath = `${tmpInput}.mp4`;
                fs.writeFileSync(videoPath, buffer);

                // Limites WhatsApp : max 3 secondes, max 1 MB, 512x512
                console.log('🎞️ Conversion vidéo → WebP animé (3s max)...');
                execSync(
                    `ffmpeg -y -i "${videoPath}" ` +
                    `-t 3 ` +
                    `-vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" ` +
                    `-vcodec libwebp -lossless 0 -q:v 50 -preset default -loop 0 -an -vsync 0 ` +
                    `-s 512:512 "${tmpWebp}"`,
                    { stdio: 'ignore' }
                );

                // Nettoyage du MP4 temporaire
                try { fs.unlinkSync(videoPath); } catch (_) {}

                // Vérification de la taille (limite WhatsApp : 1 MB)
                const stats = fs.statSync(tmpWebp);
                if (stats.size > 1024 * 1024) {
                    console.log('⚠️ Sticker > 1 MB, recompression...');
                    execSync(
                        `ffmpeg -y -i "${tmpWebp}" -vcodec libwebp -lossless 0 -q:v 25 -loop 0 -an "${tmpWebp}.tmp" ` +
                        `&& mv "${tmpWebp}.tmp" "${tmpWebp}"`,
                        { stdio: 'ignore' }
                    );
                }
            }

            const stickerBuffer = fs.readFileSync(tmpWebp);
            console.log(`📦 Taille : ${(stickerBuffer.length / 1024).toFixed(1)} KB`);

            if (stickerBuffer.length > 1024 * 1024) {
                await sock.sendMessage(ctx.from, {
                    text: `❌ Sticker trop gros (${(stickerBuffer.length / 1024).toFixed(0)} KB). Max 1 MB.`
                }, { quoted: msg });
                return;
            }

            console.log('📤 Envoi...');
            await sock.sendMessage(ctx.from, { sticker: stickerBuffer }, { quoted: msg });
            console.log('✅ [STICKER] Envoyé');

        } catch (e) {
            console.error('❌ Erreur sticker:', e.message);
            await sock.sendMessage(ctx.from, { text: `❌ Erreur: ${e.message}` }, { quoted: msg });
        } finally {
            try { if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng); } catch (_) {}
            try { if (fs.existsSync(tmpWebp)) fs.unlinkSync(tmpWebp); } catch (_) {}
        }
    }
};

// ==========================================
// HELPERS
// ==========================================

function buildQuotedSource(msg, quoted, ctx) {
    return {
        key: {
            remoteJid: ctx.from,
            fromMe: false,
            id: msg.message.extendedTextMessage.contextInfo.stanzaId,
            participant: msg.message.extendedTextMessage.contextInfo.participant
        },
        message: quoted
    };
}

/**
 * Ajoute une légende en bas du sticker avec fond semi-transparent
 * et retour à la ligne automatique.
 */
async function addCaption(image, caption) {
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    // Chargement des polices Jimp (blanche et noire)
    const fontWhite = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontWhiteSmall = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

    // Choix de la police selon la longueur du texte
    const font = caption.length > 25 ? fontWhiteSmall : fontWhite;
    const fontSize = caption.length > 25 ? 16 : 32;
    const lineHeight = fontSize + 6;
    const padding = 12;

    // Découpage du texte en lignes qui tiennent dans la largeur
    const maxWidth = width - padding * 2;
    const lines = wrapText(caption, font, maxWidth);

    // Hauteur du bloc légende
    const captionHeight = lines.length * lineHeight + padding * 2;
    const captionY = height - captionHeight;

    // Fond semi-transparent noir derrière le texte
    const black = Jimp.rgbaToInt(0, 0, 0, 180);
    for (let y = captionY; y < height; y++) {
        for (let x = 0; x < width; x++) {
            image.setPixelColor(black, x, y);
        }
    }

    // Dessin du texte centré
    let y = captionY + padding;
    for (const line of lines) {
        const lineWidth = Jimp.measureText(font, line);
        const x = Math.max(padding, (width - lineWidth) / 2);
        image.print(font, x, y, line);
        y += lineHeight;
    }
}

/**
 * Découpe un texte en lignes selon la largeur max.
 */
function wrapText(text, font, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        const width = Jimp.measureText(font, test);
        if (width > maxWidth && current) {
            lines.push(current);
            current = word;
        } else {
            current = test;
        }
    }
    if (current) lines.push(current);
    return lines;
}
