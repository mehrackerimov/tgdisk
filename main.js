const crypto = require("node:crypto");
const dotenv = require("dotenv");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { JSONFilePreset } = require("lowdb/node");
const path = require("node:path");
const readline = require("node:readline");
const { Logger, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { parseUploadArguments } = require("./lib/command");
const { downloadFile } = require("./lib/download");
const { uploadFile } = require("./lib/upload");

dotenv.config({ quiet: true });

const key = crypto.scryptSync(process.env.MASTER_PASSWORD, "tgdisk", 32);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let client;
const PAGE_SIZE = 50;

const paint = {
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    dim: (text) => `\x1b[2m${text}\x1b[0m`
};

function formatSize(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }
    return `${size.toFixed(1)} ${units[unit]}`;
}

function showBanner() {
    console.log(paint.cyan("\n╔══════════════════════════════╗\n║         TGDisk CLI           ║\n╚══════════════════════════════╝"));
    console.log(paint.dim("Secure file archive on Telegram · type help\n"));
}

function shorten(text, maxLength) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function showFiles(files, page) {
    if (files.length === 0) {
        console.log(paint.yellow("The archive is empty."));
        return;
    }
    const pageCount = Math.ceil(files.length / PAGE_SIZE);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
        throw new Error(`Choose a page between 1 and ${pageCount}.`);
    }
    const start = (page - 1) * PAGE_SIZE;
    const visibleFiles = files.slice(start, start + PAGE_SIZE);
    console.log(paint.cyan(`\n  Archive · ${files.length} files · page ${page}/${pageCount}`));
    console.log(paint.cyan("  ID    File name                                  Size       Description"));
    console.log(paint.dim("  ────  ───────────────────────────────────────── ────────── ─────────────────────────"));
    visibleFiles.forEach((file, index) => {
        const name = shorten(file.name, 41);
        const description = file.description ? shorten(file.description, 25) : "—";
        console.log(`  ${String(start + index).padStart(4)}  ${name.padEnd(41)} ${formatSize(file.size).padStart(10)} ${description}`);
    });
    console.log(paint.dim(`\n  Use list <page> to browse the archive.\n`));
}

async function getDatabase() {
    return JSONFilePreset("db.json", { files: [] });
}

async function handleCommand(command) {
    const trimmed = command.trim();
    const firstWhitespace = trimmed.search(/\s/);
    const cmd = (firstWhitespace === -1 ? trimmed : trimmed.slice(0, firstWhitespace)).toLowerCase();
    const argumentText = firstWhitespace === -1 ? "" : trimmed.slice(firstWhitespace).trim();
    const db = await getDatabase();

    switch (cmd) {
        case "upload": {
            const { filePath, description } = parseUploadArguments(argumentText);
            let latestProgress = -10;
            const entry = await uploadFile({
                client,
                filePath,
                key,
                description,
                onStage: (stage) => console.log(paint.cyan(`› ${stage}...`)),
                onProgress: (percent) => {
                    if (percent === 100 || percent - latestProgress >= 10) {
                        latestProgress = percent;
                        process.stdout.write(`\r${paint.dim(`  Upload: ${String(percent).padStart(3)}%`)}`);
                    }
                }
            });
            process.stdout.write("\n");
            db.data.files.push(entry);
            await db.write();
            console.log(paint.green(`✓ Uploaded and added to the archive: ${entry.name} (${formatSize(entry.size)})`));
            break;
        }
        case "download": {
            if (!/^\d+$/.test(argumentText)) throw new Error("Usage: download <id>");
            const entry = db.data.files[Number(argumentText)];
            if (!entry) throw new Error("No file exists with this ID.");
            console.log(paint.cyan(`› Downloading: ${entry.name}`));
            const outputPath = await downloadFile({
                client,
                fileEntry: entry,
                key,
                onProgress: (current, total) => process.stdout.write(`\r${paint.dim(`  Part: ${current}/${total}`)}`)
            });
            process.stdout.write("\n");
            console.log(paint.green(`✓ Downloaded: ${outputPath}`));
            break;
        }
        case "list":
            if (argumentText && !/^\d+$/.test(argumentText)) throw new Error("Usage: list [page]");
            showFiles(db.data.files, Number(argumentText || 1));
            break;
        case "help":
            console.log("\n  upload <path> [--description <text>]  Upload a file\n  download <id>                          Download a file\n  list [page]                            Browse archive pages\n  exit                                   Close TGDisk\n\n  Examples:\n  upload \"C:\\My Files\\report.pdf\" --description \"Quarterly report\"\n  upload C:\\Backups\\my    spaced    file.zip\n");
            break;
        case "exit":
        case "quit":
            console.log(paint.dim("Goodbye."));
            await client.disconnect();
            rl.close();
            return false;
        case "":
            break;
        default:
            throw new Error("Unknown command. Type help to see available commands.");
    }
    return true;
}

function prompt() {
    rl.question(paint.cyan("tgdisk › "), async (command) => {
        try {
            if (await handleCommand(command)) prompt();
        } catch (error) {
            console.error(paint.red(`✗ ${error.message}`));
            prompt();
        }
    });
}

(async () => {
    if (!fs.existsSync("session.txt")) await fsp.writeFile("session.txt", "");
    const session = new StringSession(await fsp.readFile("session.txt", "utf8"));
    client = new TelegramClient(session, Number(process.env.APP_ID), process.env.API_HASH, {
        connectionRetries: 5,
        baseLogger: new Logger("none")
    });
    client.setLogLevel("none");
    await client.start({
        phoneNumber: () => new Promise((resolve) => rl.question("Phone number: ", resolve)),
        password: () => new Promise((resolve) => rl.question("Two-factor password: ", resolve)),
        phoneCode: () => new Promise((resolve) => rl.question("Telegram code: ", resolve))
    });
    await fsp.writeFile("session.txt", client.session.save());
    showBanner();
    prompt();
})().catch((error) => {
    console.error(paint.red(`Startup failed: ${error.message}`));
    process.exitCode = 1;
});
