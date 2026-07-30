const assert = require("node:assert/strict");
const test = require("node:test");
const { parseUploadArguments } = require("../lib/command");

test("preserves whitespace in unquoted upload paths", () => {
    assert.deepEqual(
        parseUploadArguments("C:\\Backups\\my    spaced    file.zip"),
        { filePath: "C:\\Backups\\my    spaced    file.zip", description: "" }
    );
});

test("accepts quoted paths and optional descriptions", () => {
    assert.deepEqual(
        parseUploadArguments('"C:\\My Files\\report.pdf" --description "Quarterly report"'),
        { filePath: "C:\\My Files\\report.pdf", description: "Quarterly report" }
    );
});

test("does not treat --description inside a quoted path as an option", () => {
    assert.deepEqual(
        parseUploadArguments('"C:\\Files\\--description report.pdf"'),
        { filePath: "C:\\Files\\--description report.pdf", description: "" }
    );
});
