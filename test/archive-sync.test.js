const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const test = require("node:test");
const { INDEX_MARKER, restoreArchiveIndex, syncArchiveIndex } = require("../lib/archive-sync");

function database(data = {}) {
    return { data: { files: [], directories: [], ...data }, async write() {} };
}

function archiveClient() {
    const messages = [];
    return {
        async *iterMessages(_peer, { search }) {
            for (const message of [...messages].reverse()) if (message.message.includes(search)) yield message;
        },
        async downloadMedia(media) { return media.payload; },
        async sendFile(_peer, { file, caption }) {
            const message = { id: messages.length + 1, message: caption, media: { payload: await fs.readFile(file) } };
            messages.push(message);
            return message;
        },
        async deleteMessages(_peer, ids) {
            for (const id of ids) messages.splice(messages.findIndex((message) => message.id === id), 1);
        },
        messages
    };
}

test("syncs an encrypted archive index and restores it on another computer", async () => {
    const client = archiveClient();
    const key = Buffer.alloc(32, 7);
    const source = database({ files: [{ name: "shared.txt", virtualPath: "/docs", parts: [{ part: 0, messageId: 42 }] }], directories: ["/docs"] });

    assert.equal(await syncArchiveIndex({ client, key, database: source }), 1);
    assert.equal(client.messages[0].message, INDEX_MARKER);
    const destination = database();
    assert.equal(await restoreArchiveIndex({ client, key, database: destination }), true);
    assert.equal(destination.data.files[0].name, "shared.txt");
    assert.equal(destination.data.archiveRevision, 1);
});

test("rejects a stale computer instead of overwriting newer archive metadata", async () => {
    const client = archiveClient();
    const key = Buffer.alloc(32, 3);
    const first = database({ files: [{ name: "first", parts: [] }] });
    await syncArchiveIndex({ client, key, database: first });
    first.data.files.push({ name: "second", parts: [] });
    await syncArchiveIndex({ client, key, database: first });

    const stale = database({ files: [{ name: "old", parts: [] }], archiveRevision: 1 });
    await assert.rejects(() => syncArchiveIndex({ client, key, database: stale }), /changed on another computer/);
});
