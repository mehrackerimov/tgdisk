const { WebSocketServer } = require("ws");

// JSON protocol: command -> {type:"command", id, command}; answers ->
// {type:"answer", requestId, value}.  Events and final results retain the id.
function startWebSocketServer({ port, createSession, token }) {
    const server = new WebSocketServer({ port, host: "127.0.0.1", maxPayload: 64 * 1024 });
    // lowdb writes and Telegram mutations must not overlap across UI sessions.
    let operationQueue = Promise.resolve();
    server.on("connection", (socket) => {
        const session = createSession();
        const pendingAnswers = new Map();
        let authenticated = !token;
        const send = (message) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(message));

        socket.on("message", (raw) => {
            let message;
            try { message = JSON.parse(raw.toString()); } catch { send({ type: "error", error: "Messages must be valid JSON." }); return; }
            if (!authenticated) {
                if (message.type !== "authenticate" || !safeEqual(message.token, token)) {
                    send({ type: "error", error: "Authentication failed." });
                    socket.close(1008, "Authentication required");
                    return;
                }
                authenticated = true;
                send({ type: "authenticated" });
                return;
            }
            if (message.type === "answer") {
                const resolve = pendingAnswers.get(message.requestId);
                if (resolve) { pendingAnswers.delete(message.requestId); resolve(message.value); }
                return;
            }
            if (message.type !== "command" || typeof message.id !== "string" || typeof message.command !== "string") {
                send({ type: "error", error: "Expected a command with string id and command fields." });
                return;
            }
            operationQueue = operationQueue.then(async () => {
                const ask = (request) => new Promise((resolve) => {
                    const requestId = `${message.id}:${crypto.randomUUID()}`;
                    pendingAnswers.set(requestId, resolve);
                    send({ type: "prompt", id: message.id, requestId, ...request });
                    setTimeout(() => {
                        if (pendingAnswers.delete(requestId)) resolve("");
                    }, 5 * 60 * 1000).unref();
                });
                try {
                    const result = await session.execute(message.command, { ask, emit: (event) => send({ type: "event", id: message.id, ...event }) });
                    send({ type: "result", id: message.id, ok: true, result });
                } catch (error) {
                    send({ type: "result", id: message.id, ok: false, error: error.message });
                }
            });
        });
        socket.on("close", () => { for (const resolve of pendingAnswers.values()) resolve(""); pendingAnswers.clear(); });
        send({ type: "ready", protocol: "tgdisk.v1", authenticationRequired: Boolean(token) });
    });
    return server;
}

const crypto = require("node:crypto");

function safeEqual(value, expected) {
    if (typeof value !== "string" || typeof expected !== "string") return false;
    const left = Buffer.from(value);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
module.exports = { startWebSocketServer };
