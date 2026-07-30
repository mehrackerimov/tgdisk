const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");
const { ENCRYPTION_FORMAT } = require("./download");
const DEFAULT_PART_SIZE_BYTES = 200 * 1024 * 1024;

async function uploadFile({ client, filePath, key, description, onStage, onProgress, partSizeBytes = DEFAULT_PART_SIZE_BYTES }) {
    const absolutePath = path.resolve(filePath);
    const stats = await fsp.stat(absolutePath);
    if (!stats.isFile()) {
        throw new Error("Only regular files can be uploaded.");
    }

    const tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "tgdisk-upload-"));
    const compressedPath = path.join(tempDirectory, "payload.gz");
    const encryptedPath = path.join(tempDirectory, "payload.enc");

    try {
        onStage?.("Compressing file");
        await pipeline(
            fs.createReadStream(absolutePath),
            zlib.createGzip({ level: 9 }),
            fs.createWriteStream(compressedPath)
        );

        onStage?.("Encrypting file");
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        await fsp.writeFile(encryptedPath, iv);
        await pipeline(
            fs.createReadStream(compressedPath),
            cipher,
            fs.createWriteStream(encryptedPath, { flags: "a" })
        );
        await fsp.appendFile(encryptedPath, cipher.getAuthTag());

        const encryptedSize = (await fsp.stat(encryptedPath)).size;
        const partCount = Math.ceil(encryptedSize / partSizeBytes);
        const parts = [];

        for (let partIndex = 0; partIndex < partCount; partIndex++) {
            const start = partIndex * partSizeBytes;
            const end = Math.min(start + partSizeBytes, encryptedSize) - 1;
            const partPath = partCount === 1 ? encryptedPath : path.join(tempDirectory, `payload.part-${partIndex}`);
            if (partCount > 1) {
                await pipeline(fs.createReadStream(encryptedPath, { start, end }), fs.createWriteStream(partPath));
            }

            onStage?.(partCount === 1 ? "Uploading to Telegram" : `Uploading part ${partIndex + 1}/${partCount} to Telegram`);
            const message = await client.sendFile("me", {
                file: partPath,
                forceDocument: true,
                progressCallback: (uploaded, total) => {
                    if (!total) return;
                    const currentPartPercent = Math.min(1, Number(uploaded) / Number(total));
                    const percent = Math.floor(((partIndex + currentPartPercent) / partCount) * 100);
                    if (percent > 0) onProgress?.(percent);
                }
            });
            parts.push({
                part: partIndex,
                messageId: message.id,
                size: end - start + 1
            });
            if (partCount > 1) await fsp.rm(partPath, { force: true });
        }

        return {
            name: path.basename(absolutePath),
            size: stats.size,
            compressed: true,
            compression: "gzip",
            encrypted: true,
            cipher: "aes-256-gcm",
            encryptionFormat: ENCRYPTION_FORMAT,
            description: description || undefined,
            createdAt: new Date().toISOString(),
            parts
        };
    } finally {
        await fsp.rm(tempDirectory, { recursive: true, force: true });
    }
}

module.exports = { DEFAULT_PART_SIZE_BYTES, uploadFile };
