const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const INDEX_MARKER = "tgdisk-archive-index:v1";
const INDEX_NAME = "tgdisk-archive-index.enc";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

async function findLatestIndex(client) {
    for await (const message of client.iterMessages("me", { search: INDEX_MARKER, limit: 10 })) {
        if (message?.message === INDEX_MARKER && message.media) return message;
    }
    return null;
}

async function restoreArchiveIndex({ client, key, database }) {
    const message = await findLatestIndex(client);
    if (!message) return false;
    const encrypted = await client.downloadMedia(message.media);
    if (!Buffer.isBuffer(encrypted)) throw new Error("The synced archive index could not be downloaded.");
    const index = decryptIndex(encrypted, key);
    database.data.files = index.files;
    database.data.directories = index.directories;
    database.data.archiveRevision = index.revision;
    database.data.archiveIndexInitialized = true;
    await database.write();
    return true;
}

async function syncArchiveIndex({ client, key, database }) {
    const previous = await findLatestIndex(client);
    const remoteRevision = previous ? decryptIndex(await client.downloadMedia(previous.media), key).revision : 0;
    const knownRevision = Number(database.data.archiveRevision || 0);
    if (knownRevision && remoteRevision !== knownRevision) {
        throw new Error("The archive was changed on another computer. Restart TGDisk to reload it before making more changes.");
    }
    const index = {
        version: 1,
        revision: remoteRevision + 1,
        updatedAt: new Date().toISOString(),
        files: database.data.files || [],
        directories: database.data.directories || []
    };
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "tgdisk-index-"));
    const indexPath = path.join(temporaryDirectory, INDEX_NAME);
    try {
        await fs.writeFile(indexPath, encryptIndex(index, key));
        const uploaded = await client.sendFile("me", { file: indexPath, caption: INDEX_MARKER, forceDocument: true });
        database.data.archiveRevision = index.revision;
        database.data.archiveIndexInitialized = true;
        await database.write();
        if (previous?.id && previous.id !== uploaded.id) {
            await client.deleteMessages("me", [previous.id], { revoke: true }).catch(() => {});
        }
        return index.revision;
    } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

function encryptIndex(index, key) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(index)));
    return Buffer.concat([iv, cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);
}

function decryptIndex(payload, key) {
    if (!Buffer.isBuffer(payload) || payload.length <= IV_LENGTH + AUTH_TAG_LENGTH) throw new Error("The synced archive index is corrupt.");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(0, IV_LENGTH));
    decipher.setAuthTag(payload.subarray(-AUTH_TAG_LENGTH));
    let index;
    try {
        index = JSON.parse(zlib.gunzipSync(Buffer.concat([decipher.update(payload.subarray(IV_LENGTH, -AUTH_TAG_LENGTH)), decipher.final()])).toString("utf8"));
    } catch {
        throw new Error("The synced archive index could not be decrypted. Check MASTER_PASSWORD.");
    }
    if (index?.version !== 1 || !Number.isInteger(index.revision) || !Array.isArray(index.files) || !Array.isArray(index.directories)) {
        throw new Error("The synced archive index has an unsupported format.");
    }
    return index;
}

module.exports = { INDEX_MARKER, decryptIndex, encryptIndex, restoreArchiveIndex, syncArchiveIndex };
