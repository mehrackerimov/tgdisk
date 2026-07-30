const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");
const { ENCRYPTION_FORMAT } = require("./download");

async function uploadFile({ client, filePath, key, onStage, onProgress }) {
    const absolutePath = path.resolve(filePath);
    const stats = await fsp.stat(absolutePath);
    if (!stats.isFile()) {
        throw new Error("Yalnızca dosya yüklenebilir.");
    }

    const tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "tgdisk-upload-"));
    const compressedPath = path.join(tempDirectory, "payload.gz");
    const encryptedPath = path.join(tempDirectory, "payload.enc");

    try {
        onStage?.("Dosya sıkıştırılıyor");
        await pipeline(
            fs.createReadStream(absolutePath),
            zlib.createGzip({ level: 9 }),
            fs.createWriteStream(compressedPath)
        );

        onStage?.("Dosya şifreleniyor");
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        await fsp.writeFile(encryptedPath, iv);
        await pipeline(
            fs.createReadStream(compressedPath),
            cipher,
            fs.createWriteStream(encryptedPath, { flags: "a" })
        );
        await fsp.appendFile(encryptedPath, cipher.getAuthTag());

        onStage?.("Telegram'a yükleniyor");
        let lastPercent = -1;
        const message = await client.sendFile("me", {
            file: encryptedPath,
            forceDocument: true,
            progressCallback: (uploaded, total) => {
                const percent = total ? Math.floor((Number(uploaded) / Number(total)) * 100) : 0;
                if (percent !== lastPercent) {
                    lastPercent = percent;
                    onProgress?.(percent);
                }
            }
        });

        return {
            name: path.basename(absolutePath),
            size: stats.size,
            compressed: true,
            compression: "gzip",
            encrypted: true,
            cipher: "aes-256-gcm",
            encryptionFormat: ENCRYPTION_FORMAT,
            parts: [{
                part: 0,
                messageId: message.id,
                size: (await fsp.stat(encryptedPath)).size
            }]
        };
    } finally {
        await fsp.rm(tempDirectory, { recursive: true, force: true });
    }
}

module.exports = { uploadFile };
