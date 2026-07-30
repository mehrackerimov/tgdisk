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
        onStage: (stage) => stages.push(stage)
    });

    const iv = uploaded.subarray(0, 12);
    const authTag = uploaded.subarray(-16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const compressed = Buffer.concat([decipher.update(uploaded.subarray(12, -16)), decipher.final()]);

    assert.deepEqual(zlib.gunzipSync(compressed), original);
    assert.equal(entry.encryptionFormat, ENCRYPTION_FORMAT);
    assert.equal(entry.parts[0].messageId, 42);
    assert.deepEqual(stages, ["Dosya sıkıştırılıyor", "Dosya şifreleniyor", "Telegram'a yükleniyor"]);
});
