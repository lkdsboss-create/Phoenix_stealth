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

        // Paramètre optionnel de position (haut / centre / bas)
        const argsCopy = [...ctx.args];
        let position = 'auto';
        if (['haut', 'centre', 'bas'].includes(argsCopy[0]?.toLowerCase())) {
            position = argsCopy.shift().toLowerCase();
        }
        const caption = argsCopy.join(' ').trim();

        // Détection média
        let mediaMsg = null;
        let mediaType = null;
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
                text: '❌ Envoie un média avec !sticker [haut|centre|bas] [légende]'
            }, { quoted: msg });
            return;
        }

        const finalCaption = mediaType === 'video' ? '' : caption;

        const tmpId = Date.now();
        const tmpPng = path.join(os.tmpdir(), `stick_${tmpId}.png`);
        const tmpWebp = path.join(os.tmpdir(), `stick_${tmpId}.webp`);
        const tmpVideo = path.join(os.tmpdir(), `stick_${tmpId}.mp4`);

        try {
            console.log('📥 Téléchargement...');
            const buffer = await downloadMediaMessage(
                sourceMsg, 'buffer', {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );

            if (mediaType === 'image') {
                console.log('🖼️ Traitement image...');
                const image = await Jimp.fromBuffer(buffer);

                const origW = image.bitmap.width;
                const origH = image.bitmap.height;
                const ratio = origW / origH;

                const side = Math.min(origW, origH);
                const cropX = Math.floor((origW - side) / 2);

                // ✅ Crop intelligent : position dépend du ratio
                let cropY;
                let effectivePosition = position;

                if (position === 'auto') {
                    if (ratio < 0.7) {
                        // Portrait étroit (ex : 9:16) → privilégie le HAUT
                        effectivePosition = 'haut';
                    } else if (ratio < 1) {
                        // Portrait normal (ex : 4:5) → légèrement au-dessus du centre
                        effectivePosition = 'centre-haut';
                    } else {
                        // Carré ou paysage → centre
                        effectivePosition = 'centre';
                    }
                }

                if (effectivePosition === 'haut') {
                    cropY = Math.floor((origH - side) * 0.05); // 5% en haut
                } else if (effectivePosition === 'centre-haut') {
                    cropY = Math.floor((origH - side) * 0.3); // 30% en haut
                } else if (effectivePosition === 'bas') {
                    cropY = Math.floor((origH - side) * 0.95);
                } else {
                    // centre
                    cropY = Math.floor((origH - side) / 2);
                }

                console.log(`📐 Crop: ${origW}x${origH} (ratio ${ratio.toFixed(2)}) → ${side}x${side} @ (${cropX},${cropY}) [${effectivePosition}]`);

                image.crop({ x: cropX, y: cropY, w: side, h: side });
                image.resize({ w: 512, h: 512 });

                if (finalCaption) {
                    console.log('✏️ Ajout légende :', finalCaption);
                    await addCaption(image, finalCaption);
                }

                const pngBuffer = await image.getBuffer('image/png');
                fs.writeFileSync(tmpPng, pngBuffer);

                execSync(
                    `ffmpeg -y -i "${tmpPng}" -vcodec libwebp -lossless 0 -q:v 80 -preset default -an -vsync 0 "${tmpWebp}"`,
                    { stdio: 'ignore' }
                );

            } else {
                // ==========================================
                // VIDÉO → STICKER ANIMÉ
                // ==========================================
                console.log('🎬 Traitement vidéo...');
                fs.writeFileSync(tmpVideo, buffer);

                // Expression ffmpeg pour calculer le cropY
                // ratio < 0.7 → haut (5%) ; ratio < 1 → centre-haut (30%) ; sinon centre
                let cropExpr;
                if (position === 'haut') {
                    cropExpr = `(ih-min(iw\\,ih))*0.05`;
                } else if (position === 'bas') {
                    cropExpr = `(ih-min(iw\\,ih))*0.95`;
                } else if (position === 'centre') {
                    cropExpr = `(ih-min(iw\\,ih))/2`;
                } else {
                    // auto : crop adaptatif
                    cropExpr = `if(lt(iw/ih\\,0.7)\\,(ih-min(iw\\,ih))*0.05\\,if(lt(iw/ih\\,1)\\,(ih-min(iw\\,ih))*0.3\\,(ih-min(iw\\,ih))/2))`;
                }

                const vfFilter = `fps=15,crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:${cropExpr},scale=512:512`;

                console.log('🎞️ Conversion vidéo → WebP animé (3s, crop adaptatif)...');
                execSync(
                    `ffmpeg -y -i "${tmpVideo}" ` +
                    `-t 3 ` +
                    `-vf "${vfFilter}" ` +
                    `-vcodec libwebp -lossless 0 -q:v 50 -preset default -loop 0 -an -vsync 0 ` +
                    `-s 512:512 "${tmpWebp}"`,
                    { stdio: 'ignore' }
                );

                try { fs.unlinkSync(tmpVideo); } catch (_) {}

                // Vérification taille
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
            try { if (fs.existsSync(tmpVideo)) fs.unlinkSync(tmpVideo); } catch (_) {}
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

async function addCaption(image, caption) {
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    const fontWhite = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontWhiteSmall = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

    const font = caption.length > 25 ? fontWhiteSmall : fontWhite;
    const fontSize = caption.length > 25 ? 16 : 32;
    const lineHeight = fontSize + 6;
    const padding = 12;

    const maxWidth = width - padding * 2;
    const lines = wrapText(caption, font, maxWidth);

    const captionHeight = lines.length * lineHeight + padding * 2;
    const captionY = height - captionHeight;

    const black = Jimp.rgbaToInt(0, 0, 0, 180);
    for (let y = captionY; y < height; y++) {
        for (let x = 0; x < width; x++) {
            image.setPixelColor(black, x, y);
        }
    }

    let y = captionY + padding;
    for (const line of lines) {
        const lineWidth = Jimp.measureText(font, line);
        const x = Math.max(padding, (width - lineWidth) / 2);
        image.print(font, x, y, line);
        y += lineHeight;
    }
}

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
