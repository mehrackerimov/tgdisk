const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const { downloadFile, ENCRYPTION_FORMAT } = require("../lib/download");

function encrypt(plainText, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const compressed = zlib.gzipSync(plainText);
    return Buffer.concat([iv, cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);
}

function makeClient(chunks) {
    return {
        async getMessages(_peer, { ids }) {
            return [{ media: { messageId: ids } }];
        },
        async downloadMedia(media) {
            return chunks.get(media.messageId);
        }
    };
}

test("downloads encrypted parts in their declared order and restores original bytes", async (t) => {
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), "tgdisk-test-"));
    t.after(() => fs.rm(destination, { recursive: true, force: true }));
    const key = crypto.randomBytes(32);
    const original = Buffer.from("Telegram disk download regression test\n");
    const encrypted = encrypt(original, key);
    const split = Math.floor(encrypted.length / 2);
    const chunks = new Map([[10, encrypted.subarray(0, split)], [20, encrypted.subarray(split)]]);
    const progress = [];

    const output = await downloadFile({
        client: makeClient(chunks),
        key,
        destinationDirectory: destination,
        fileEntry: {
            name: "restored.txt",
            compressed: true,
            cipher: "aes-256-gcm",
            encryptionFormat: ENCRYPTION_FORMAT,
            parts: [{ part: 1, messageId: 20 }, { part: 0, messageId: 10 }]
        },
        onProgress: (current, total) => progress.push([current, total])
    });

    assert.equal(await fs.readFile(output, "utf8"), original.toString());
    assert.deepEqual(progress, [[1, 2], [2, 2]]);
});

test("does not create an output file when authentication fails", async (t) => {
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), "tgdisk-test-"));
    t.after(() => fs.rm(destination, { recursive: true, force: true }));
    const key = crypto.randomBytes(32);
    const encrypted = encrypt(Buffer.from("secret"), key);
    encrypted[20] ^= 0xff;

    await assert.rejects(() => downloadFile({
        client: makeClient(new Map([[1, encrypted]])),
        key,
        destinationDirectory: destination,
        fileEntry: { name: "should-not-exist.txt", encryptionFormat: ENCRYPTION_FORMAT, parts: [{ part: 0, messageId: 1 }] }
    }));
    await assert.rejects(fs.access(path.join(destination, "should-not-exist.txt")));
});

test("rejects unsafe names and refuses to overwrite files", async (t) => {
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), "tgdisk-test-"));
    t.after(() => fs.rm(destination, { recursive: true, force: true }));
    const key = crypto.randomBytes(32);
    const encrypted = encrypt(Buffer.from("new content"), key);
    await fs.writeFile(path.join(destination, "existing.txt"), "keep this");

    await assert.rejects(() => downloadFile({
        client: makeClient(new Map([[1, encrypted]])), key, destinationDirectory: destination,
        fileEntry: { name: "existing.txt", encryptionFormat: ENCRYPTION_FORMAT, parts: [{ part: 0, messageId: 1 }] }
    }), /already exists/);
    await assert.rejects(() => downloadFile({
        client: makeClient(new Map([[1, encrypted]])), key, destinationDirectory: destination,
        fileEntry: { name: "..", encryptionFormat: ENCRYPTION_FORMAT, parts: [{ part: 0, messageId: 1 }] }
    }), /valid name/);
    assert.equal(await fs.readFile(path.join(destination, "existing.txt"), "utf8"), "keep this");
});

test("rejects legacy records that cannot be decrypted safely", async () => {
    await assert.rejects(() => downloadFile({
        client: makeClient(new Map()), key: crypto.randomBytes(32),
        fileEntry: { name: "legacy.txt", parts: [{ part: 0, messageId: 1 }] }
    }), /missing encryption metadata/);
});
