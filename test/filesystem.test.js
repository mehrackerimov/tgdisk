const assert = require("node:assert/strict");
const test = require("node:test");
const { directoryExists, ensureDirectory, listDirectory, normalizeVirtualPath } = require("../lib/filesystem");

test("normalizes relative, absolute, and Windows-style virtual paths", () => {
    assert.equal(normalizeVirtualPath("../photos", "/archive/reports"), "/archive/photos");
    assert.equal(normalizeVirtualPath("C:\\Users\\alex\\Downloads"), "/C:/Users/alex/Downloads");
    assert.equal(normalizeVirtualPath("/archive//2026/../2025"), "/archive/2025");
});

test("creates parent folders and lists only direct children", () => {
    const database = { data: { files: [], directories: [] } };
    ensureDirectory(database, "/archive/photos/2026");
    ensureDirectory(database, "/archive/documents");
    database.data.files.push({ name: "cover.jpg", virtualPath: "/archive/photos" });

    assert.equal(directoryExists(database, "/archive/photos"), true);
    assert.deepEqual(listDirectory(database, "/archive").folders, ["/archive/documents", "/archive/photos"]);
    assert.deepEqual(listDirectory(database, "/archive/photos").files.map((file) => file.name), ["cover.jpg"]);
});
