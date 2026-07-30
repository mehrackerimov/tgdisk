const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const { ENCRYPTION_FORMAT } = require("../lib/download");
const { uploadFile } = require("../lib/upload");

test("creates a self-contained encrypted upload that can be authenticated and restored", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tgdisk-upload-test-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, "archive.txt");
    const original = Buffer.from("TGDisk upload test content\n");
    await fs.writeFile(source, original);
    const key = crypto.randomBytes(32);
    let uploaded;
    const stages = [];

    const entry = await uploadFile({
        client: {
            async sendFile(_peer, { file, progressCallback }) {
                uploaded = await fs.readFile(file);
                progressCallback(uploaded.length, uploaded.length);
                return { id: 42 };
            }
        },
        filePath: source,
        key,
        description: "A test archive",
        onStage: (stage) => stages.push(stage)
    });

    const iv = uploaded.subarray(0, 12);
    const authTag = uploaded.subarray(-16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const compressed = Buffer.concat([decipher.update(uploaded.subarray(12, -16)), decipher.final()]);

    assert.deepEqual(zlib.gunzipSync(compressed), original);
    assert.equal(entry.encryptionFormat, ENCRYPTION_FORMAT);
    assert.equal(entry.description, "A test archive");
    assert.equal(entry.parts[0].messageId, 42);
    assert.deepEqual(stages, ["Compressing file", "Encrypting file", "Uploading to Telegram"]);
});

test("splits large encrypted uploads into ordered Telegram parts", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tgdisk-upload-test-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, "large.bin");
    const original = crypto.randomBytes(512);
    await fs.writeFile(source, original);
    const key = crypto.randomBytes(32);
    const uploadedParts = [];
    const progress = [];

    const entry = await uploadFile({
        client: {
            async sendFile(_peer, { file, progressCallback }) {
                const content = await fs.readFile(file);
                uploadedParts.push(content);
                progressCallback(content.length, content.length);
                return { id: uploadedParts.length };
            }
        },
        filePath: source,
        key,
        partSizeBytes: 64,
        onProgress: (percent) => progress.push(percent)
    });

    const encrypted = Buffer.concat(uploadedParts);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
    decipher.setAuthTag(encrypted.subarray(-16));
    const compressed = Buffer.concat([decipher.update(encrypted.subarray(12, -16)), decipher.final()]);

    assert.ok(entry.parts.length > 1);
    assert.deepEqual(entry.parts.map((part) => part.part), entry.parts.map((_part, index) => index));
    assert.deepEqual(zlib.gunzipSync(compressed), original);
    assert.ok(progress.every((percent) => percent > 0));
    assert.equal(progress.at(-1), 100);
});
