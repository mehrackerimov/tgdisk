const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_FORMAT = "aes-256-gcm:iv-ciphertext-tag:v1";

function getSafeFileName(name) {
    const safeName = path.basename(name || "");
    if (!safeName || safeName === "." || safeName === ".." || safeName === path.sep) {
        throw new Error("Dosya kaydında geçerli bir ad yok.");
    }
    return safeName;
}

function validateFileEntry(fileEntry) {
    if (!fileEntry || !Array.isArray(fileEntry.parts) || fileEntry.parts.length === 0) {
        throw new Error("Dosya kaydı veya parça bilgisi geçersiz.");
    }
    if (fileEntry.cipher && fileEntry.cipher !== "aes-256-gcm") {
        throw new Error(`Desteklenmeyen şifreleme: ${fileEntry.cipher}`);
    }
    if (fileEntry.encryptionFormat !== ENCRYPTION_FORMAT) {
        throw new Error("Bu kayıt eski ve eksik şifreleme metadatası içeriyor; IV/doğrulama etiketi saklanmadığı için indirilemez.");
    }
    if (fileEntry.compressed === false) {
        throw new Error("Sıkıştırılmamış dosya kayıtları henüz desteklenmiyor.");
    }
}

async function downloadFile({ client, fileEntry, key, destinationDirectory = process.cwd(), onProgress }) {
    validateFileEntry(fileEntry);
    const fileName = getSafeFileName(fileEntry.name);
    const outputPath = path.join(destinationDirectory, fileName);

    await fsp.access(destinationDirectory);

    if (fs.existsSync(outputPath)) {
        throw new Error(`Hedef dosya zaten var: ${outputPath}`);
    }

    const tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "tgdisk-download-"));
    const encryptedPath = path.join(tempDirectory, "payload.enc");
    const compressedPath = path.join(tempDirectory, "payload.gz");
    const outputTempPath = path.join(destinationDirectory, `.${fileName}.tgdisk-${crypto.randomUUID()}.tmp`);

    try {
        const parts = [...fileEntry.parts].sort((a, b) => a.part - b.part);
        for (let index = 0; index < parts.length; index++) {
            const part = parts[index];
            if (!Number.isInteger(part.messageId)) {
                throw new Error(`Geçersiz Telegram mesaj kimliği (parça ${index + 1}).`);
            }

            const messages = await client.getMessages("me", { ids: part.messageId });
            const message = Array.isArray(messages) ? messages[0] : messages;
            if (!message?.media) {
                throw new Error(`Telegram mesajı bulunamadı veya medya içermiyor: ${part.messageId}`);
            }

            const content = await client.downloadMedia(message.media);
            if (!Buffer.isBuffer(content)) {
                throw new Error(`Telegram parçası indirilemedi: ${part.messageId}`);
            }
            await fsp.appendFile(encryptedPath, content);
            onProgress?.(index + 1, parts.length);
        }

        const stat = await fsp.stat(encryptedPath);
        if (stat.size <= IV_LENGTH + AUTH_TAG_LENGTH) {
            throw new Error("Şifreli veri bozuk veya eksik.");
        }

        const handle = await fsp.open(encryptedPath, "r");
        const iv = Buffer.alloc(IV_LENGTH);
        const authTag = Buffer.alloc(AUTH_TAG_LENGTH);
        try {
            await handle.read(iv, 0, IV_LENGTH, 0);
            await handle.read(authTag, 0, AUTH_TAG_LENGTH, stat.size - AUTH_TAG_LENGTH);
        } finally {
            await handle.close();
        }

        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        await pipeline(
            fs.createReadStream(encryptedPath, { start: IV_LENGTH, end: stat.size - AUTH_TAG_LENGTH - 1 }),
            decipher,
            fs.createWriteStream(compressedPath)
        );
        await pipeline(
            fs.createReadStream(compressedPath),
            zlib.createGunzip(),
            fs.createWriteStream(outputTempPath, { flags: "wx" })
        );

        // link() fails when another process creates the target after our existence check.
        // That preserves an existing file instead of replacing it during a race.
        await fsp.link(outputTempPath, outputPath);
        await fsp.unlink(outputTempPath);
        return outputPath;
    } finally {
        await fsp.rm(tempDirectory, { recursive: true, force: true });
        await fsp.rm(outputTempPath, { force: true });
    }
}

module.exports = { downloadFile, ENCRYPTION_FORMAT };
