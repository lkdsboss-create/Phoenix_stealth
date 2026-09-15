const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Jimp } = require('jimp');
const pino = require('pino');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Chemin de la police embarquée
const FONT_PATH = path.join(__dirname, '..', 'assets', 'font.ttf');

module.exports = {
    name: 'sticker',
    aliases: ['s', 'stiker', 'stikervideo', 'sv'],
    description: 'Convertit image/vidéo en sticker (avec légende optionnelle)',
    async execute(sock, msg, botState, ctx) {
        console.log('🎨 [STICKER] args:', ctx.args);

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
        const tmpPngCaption = path.join(os.tmpdir(), `stick_cap_${tmpId}.png`);
        const tmpWebp = path.join(os.tmpdir(), `stick_${tmpId}.webp`);
        const tmpVideo = path.join(os.tmpdir(), `stick_${tmpId}.mp4`);
        const tmpTxt = path.join(os.tmpdir(), `cap_${tmpId}.txt`);

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

                let cropY;
                let effectivePosition = position;

                if (position === 'auto') {
                    if (ratio < 0.7) effectivePosition = 'haut';
                    else if (ratio < 1) effectivePosition = 'centre-haut';
                    else effectivePosition = 'centre';
                }

                if (effectivePosition === 'haut') {
                    cropY = Math.floor((origH - side) * 0.05);
                } else if (effectivePosition === 'centre-haut') {
                    cropY = Math.floor((origH - side) * 0.3);
                } else if (effectivePosition === 'bas') {
                    cropY = Math.floor((origH - side) * 0.95);
                } else {
                    cropY = Math.floor((origH - side) / 2);
                }

                console.log(`📐 Crop: ${origW}x${origH} → ${side}x${side} @ (${cropX},${cropY}) [${effectivePosition}]`);

                image.crop({ x: cropX, y: cropY, w: side, h: side });
                image.resize({ w: 512, h: 512 });

                const pngBuffer = await image.getBuffer('image/png');
                fs.writeFileSync(tmpPng, pngBuffer);

                // ✅ Légende via ffmpeg drawtext
                if (finalCaption) {
                    console.log('✏️ Ajout légende via ffmpeg :', finalCaption);
                    addCaptionWithFfmpeg(tmpPng, tmpPngCaption, tmpTxt, finalCaption);

                    execSync(
                        `ffmpeg -y -i "${tmpPngCaption}" -vcodec libwebp -lossless 0 -q:v 80 -preset default -an -vsync 0 "${tmpWebp}"`,
                        { stdio: 'ignore' }
                    );
                } else {
                    execSync(
                        `ffmpeg -y -i "${tmpPng}" -vcodec libwebp -lossless 0 -q:v 80 -preset default -an -vsync 0 "${tmpWebp}"`,
                        { stdio: 'ignore' }
                    );
                }

            } else {
                // ==========================================
                // VIDÉO → STICKER ANIMÉ
                // ==========================================
                console.log('🎬 Traitement vidéo...');
                fs.writeFileSync(tmpVideo, buffer);

                let cropExpr;
                if (position === 'haut') {
                    cropExpr = `(ih-min(iw\\,ih))*0.05`;
                } else if (position === 'bas') {
                    cropExpr = `(ih-min(iw\\,ih))*0.95`;
                } else if (position === 'centre') {
                    cropExpr = `(ih-min(iw\\,ih))/2`;
                } else {
                    cropExpr = `if(lt(iw/ih\\,0.7)\\,(ih-min(iw\\,ih))*0.05\\,if(lt(iw/ih\\,1)\\,(ih-min(iw\\,ih))*0.3\\,(ih-min(iw\\,ih))/2))`;
                }

                const vfFilter = `fps=15,crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:${cropExpr},scale=512:512`;

                console.log('🎞️ Conversion vidéo → WebP animé...');
                execSync(
                    `ffmpeg -y -i "${tmpVideo}" ` +
                    `-t 3 ` +
                    `-vf "${vfFilter}" ` +
                    `-vcodec libwebp -lossless 0 -q:v 50 -preset default -loop 0 -an -vsync 0 ` +
                    `-s 512:512 "${tmpWebp}"`,
                    { stdio: 'ignore' }
                );

                try { fs.unlinkSync(tmpVideo); } catch (_) {}

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
            try { if (fs.existsSync(tmpPngCaption)) fs.unlinkSync(tmpPngCaption); } catch (_) {}
            try { if (fs.existsSync(tmpWebp)) fs.unlinkSync(tmpWebp); } catch (_) {}
            try { if (fs.existsSync(tmpVideo)) fs.unlinkSync(tmpVideo); } catch (_) {}
            try { if (fs.existsSync(tmpTxt)) fs.unlinkSync(tmpTxt); } catch (_) {}
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
 * Ajoute une légende sur l'image en utilisant le filtre drawtext de ffmpeg.
 * Écrit d'abord le texte dans un fichier pour éviter les problèmes d'échappement.
 */
function addCaptionWithFfmpeg(inputPng, outputPng, txtFile, caption) {
    // Écrit le texte dans un fichier (évite les soucis d'échappement ffmpeg)
    fs.writeFileSync(txtFile, caption, 'utf-8');

    // Taille de police adaptative
    const fontSize = caption.length > 40 ? 22 : (caption.length > 25 ? 28 : 36);
    const boxBorder = 15;

    // Le filtre drawtext :
    // - textfile : le fichier contenant le texte
    // - fontfile : la police TTF embarquée
    // - box=1 / boxcolor=black@0.7 : bandeau semi-transparent derrière le texte
    // - x=(w-text_w)/2 : centré horizontalement
    // - y=h-th-20 : 20px au-dessus du bas
    const filter = `drawtext=textfile='${txtFile}':fontfile='${FONT_PATH}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=h-th-20:box=1:boxcolor=black@0.7:boxborderw=${boxBorder}:line_spacing=6`;

    execSync(
        `ffmpeg -y -i "${inputPng}" -vf "${filter}" "${outputPng}"`,
        { stdio: 'ignore' }
    );
}
