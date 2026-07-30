const assert = require("node:assert/strict");
const test = require("node:test");
const WebSocket = require("ws");
const { startWebSocketServer } = require("../lib/websocket-server");

test("WebSocket server accepts commands and returns JSON results", async (t) => {
    const server = startWebSocketServer({ port: 0, createSession: () => ({ execute: async (command) => ({ echoed: command }) }) });
    await new Promise((resolve) => server.once("listening", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const port = server.address().port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages = [];
    await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.on("message", (raw) => {
            const message = JSON.parse(raw);
            messages.push(message);
            if (message.type === "ready") socket.send(JSON.stringify({ type: "command", id: "one", command: "pwd" }));
            if (message.type === "result") resolve();
        });
    });
    socket.close();
    assert.deepEqual(messages.at(-1), { type: "result", id: "one", ok: true, result: { echoed: "pwd" } });
});
