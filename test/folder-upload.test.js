const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectFiles, uploadDirectory } = require("../lib/folder-upload");

test("collects nested files deterministically and retains their virtual hierarchy", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tgdisk-folder-test-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = path.join(directory, "source");
    await fs.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.writeFile(path.join(source, "b.txt"), "b");
    await fs.writeFile(path.join(source, "nested", "a.txt"), "a");
    const { root, files } = await collectFiles(source);
    const uploaded = [];

    await uploadDirectory({
        client: { async sendFile() { return { id: uploaded.length + 1 }; } },
        files,
        rootDirectory: root,
        destinationDirectory: "/archive",
        key: crypto.randomBytes(32),
        onFile: (entry, current, total, relativePath) => uploaded.push({ entry, current, total, relativePath })
    });

    assert.deepEqual(uploaded.map((item) => item.relativePath), ["source/b.txt", "source/nested/a.txt"]);
    assert.deepEqual(uploaded.map((item) => item.entry.virtualPath), ["/archive/source/b.txt", "/archive/source/nested/a.txt"]);
    assert.deepEqual(uploaded.map((item) => [item.current, item.total]), [[1, 2], [2, 2]]);
});
