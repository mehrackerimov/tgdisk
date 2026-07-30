const assert = require("node:assert/strict");
const test = require("node:test");
const { createCommandService } = require("../lib/command-service");

function createDatabase() {
    return { data: { files: [], directories: [] }, writes: 0, async write() { this.writes++; } };
}

test("command service keeps virtual-directory state outside a terminal and returns structured data", async () => {
    const database = createDatabase();
    const service = createCommandService({ client: {}, key: Buffer.alloc(32), getDatabase: async () => database });

    const created = await service.execute("mkdir projects/2026");
    assert.equal(created.directory, "/projects/2026");
    assert.equal(database.writes, 1);

    await service.execute("cd projects");
    assert.deepEqual(await service.execute("pwd"), { directory: "/projects" });
    assert.deepEqual((await service.execute("ls")).folders, ["/projects/2026"]);
});

test("command service delegates confirmations to the presentation layer", async () => {
    const database = createDatabase();
    const service = createCommandService({ client: {}, key: Buffer.alloc(32), getDatabase: async () => database });
    await service.execute("mkdir empty");
    const prompts = [];
    const result = await service.execute("rmdir empty", { ask: async (prompt) => { prompts.push(prompt); return true; } });

    assert.equal(result.directory, "/empty");
    assert.equal(prompts[0].type, "confirm");
});
