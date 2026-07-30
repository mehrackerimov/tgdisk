const assert = require("node:assert/strict");
const test = require("node:test");
const { deleteArchiveFile } = require("../lib/delete");

test("deletes every Telegram part before removing the local record", async () => {
    const deleted = [];
    const database = { data: { files: [{ name: "large.zip", parts: [{ messageId: 10 }, { messageId: 11 }] }] } };
    const removed = await deleteArchiveFile({
        client: { deleteMessages: async (peer, ids, options) => deleted.push({ peer, ids, options }) },
        database,
        fileId: 0
    });

    assert.equal(removed.name, "large.zip");
    assert.deepEqual(deleted, [{ peer: "me", ids: [10, 11], options: { revoke: true } }]);
    assert.deepEqual(database.data.files, []);
});
