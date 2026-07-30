const crypto = require("node:crypto");
const dotenv = require("dotenv");
const { JSONFilePreset } = require("lowdb/node");
const path = require("node:path");
const readline = require("node:readline");
const { Logger, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { parseUploadArguments } = require("./lib/command");
const { deleteArchiveFile } = require("./lib/delete");
const { downloadFile } = require("./lib/download");
const { directoryExists, ensureDirectory, listDirectory, localDirectoryToVirtualPath, normalizeVirtualPath, removeEmptyDirectory } = require("./lib/filesystem");
const { collectFiles, uploadDirectory } = require("./lib/folder-upload");
const { uploadFile } = require("./lib/upload");
const { createCommandService } = require("./lib/command-service");
const { startWebSocketServer } = require("./lib/websocket-server");

dotenv.config({ quiet: true });

const key = crypto.scryptSync(process.env.MASTER_PASSWORD, "tgdisk", 32);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let client;
let currentDirectory = "/";
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

function showDirectory(database, directoryPath) {
    const { folders, files } = listDirectory(database, directoryPath);
    console.log(paint.cyan(`\n  ${directoryPath}`));
    if (folders.length === 0 && files.length === 0) {
        console.log(paint.dim("  This folder is empty.\n"));
        return;
    }
    for (const folder of folders) console.log(paint.cyan(`  [DIR]  ${path.posix.basename(folder)}`));
    for (const file of files) {
        const description = file.description ? paint.dim(` — ${shorten(file.description, 60)}`) : "";
        const fileId = database.data.files.indexOf(file);
        console.log(`  [FILE] ${String(fileId).padStart(4)}  ${file.name} ${paint.dim(`(${formatSize(file.size)})`)}${description}`);
    }
    console.log();
}

async function getDatabase() {
    const database = await JSONFilePreset("db.json", { files: [], directories: [], session: "" });
    database.data.files ||= [];
    database.data.directories ||= [];
    return database;
}

function ask(question) {
    return new Promise((resolve) => rl.question(question, resolve));
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
            const defaultDirectory = currentDirectory === "/" ? localDirectoryToVirtualPath(filePath) : currentDirectory;
            const destinationInput = await ask(paint.dim(`  Destination folder [${defaultDirectory}]: `));
            const destinationDirectory = normalizeVirtualPath(destinationInput || defaultDirectory, currentDirectory);
            let latestProgress = 0;
            const entry = await uploadFile({
                client,
                filePath,
                key,
                description,
                onStage: (stage) => console.log(paint.cyan(`› ${stage}...`)),
                onProgress: (percent) => {
                    if (percent > 0 && (percent === 100 || percent - latestProgress >= 10)) {
                        latestProgress = percent;
                        process.stdout.write(`\r${paint.dim(`  Upload: ${String(percent).padStart(3)}%`)}`);
                    }
                }
            });
            process.stdout.write("\n");
            entry.virtualPath = ensureDirectory(db, destinationDirectory);
            db.data.files.push(entry);
            await db.write();
            console.log(paint.green(`✓ Uploaded to ${entry.virtualPath}: ${entry.name} (${formatSize(entry.size)})`));
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
        case "upload-folder": {
            const { filePath: directoryPath, description } = parseUploadArguments(argumentText);
            const { root, files } = await collectFiles(directoryPath);
            if (files.length === 0) throw new Error("The selected directory contains no files.");
            const defaultDirectory = currentDirectory === "/" ? localDirectoryToVirtualPath(root) : currentDirectory;
            const destinationInput = await ask(paint.dim(`  Destination folder [${defaultDirectory}]: `));
            const destinationDirectory = normalizeVirtualPath(destinationInput || defaultDirectory, currentDirectory);
            const answer = await ask(paint.yellow(`  Upload ${files.length} file(s) from '${root}'? [y/N]: `));
            if (answer.trim().toLowerCase() !== "y") {
                console.log(paint.dim("Upload cancelled."));
                break;
            }
            await uploadDirectory({
                client,
                files,
                rootDirectory: root,
                destinationDirectory,
                key,
                description,
                onFile: async (entry, current, total, relativePath) => {
                    entry.virtualPath = ensureDirectory(db, path.posix.dirname(entry.virtualPath));
                    db.data.files.push(entry);
                    await db.write();
                    console.log(paint.green(`✓ [${current}/${total}] Uploaded: ${relativePath}`));
                }
            });
            break;
        }
        case "list":
            if (argumentText && !/^\d+$/.test(argumentText)) throw new Error("Usage: list [page]");
            showFiles(db.data.files, Number(argumentText || 1));
            break;
        case "ls": {
            const target = normalizeVirtualPath(argumentText || ".", currentDirectory);
            if (!directoryExists(db, target)) throw new Error(`Directory does not exist: ${target}`);
            showDirectory(db, target);
            break;
        }
        case "cd": {
            if (!argumentText) throw new Error("Usage: cd <directory>");
            const target = normalizeVirtualPath(argumentText, currentDirectory);
            if (!directoryExists(db, target)) throw new Error(`Directory does not exist: ${target}`);
            currentDirectory = target;
            break;
        }
        case "pwd":
            console.log(currentDirectory);
            break;
        case "mkdir": {
            if (!argumentText) throw new Error("Usage: mkdir <directory>");
            const target = normalizeVirtualPath(argumentText, currentDirectory);
            ensureDirectory(db, target);
            await db.write();
            console.log(paint.green(`✓ Directory created: ${target}`));
            break;
        }
        case "rm": {
            if (!/^\d+$/.test(argumentText)) throw new Error("Usage: rm <file-id>");
            const fileId = Number(argumentText);
            const file = db.data.files[fileId];
            if (!file) throw new Error("No file exists with this ID.");
            const answer = await ask(paint.yellow(`  Permanently delete '${file.name}' from Telegram and the archive? [y/N]: `));
            if (answer.trim().toLowerCase() !== "y") {
                console.log(paint.dim("Deletion cancelled."));
                break;
            }
            await deleteArchiveFile({ client, database: db, fileId });
            await db.write();
            console.log(paint.green(`✓ Deleted: ${file.name}`));
            break;
        }
        case "rmdir": {
            if (!argumentText) throw new Error("Usage: rmdir <directory>");
            const target = normalizeVirtualPath(argumentText, currentDirectory);
            const answer = await ask(paint.yellow(`  Delete empty directory '${target}'? [y/N]: `));
            if (answer.trim().toLowerCase() !== "y") {
                console.log(paint.dim("Deletion cancelled."));
                break;
            }
            removeEmptyDirectory(db, target);
            await db.write();
            if (currentDirectory === target) currentDirectory = "/";
            console.log(paint.green(`✓ Directory deleted: ${target}`));
            break;
        }
        case "help":
            console.log("\n  upload <path> [--description <text>]  Upload a file and choose its archive folder\n  upload-folder <path> [--description <text>] Upload every file in a folder after confirmation\n  download <id>                          Download a file by ID\n  ls [directory]                         List folders and files in the current archive directory\n  cd <directory>                         Change archive directory\n  pwd                                    Print current archive directory\n  mkdir <directory>                      Create an archive directory\n  rmdir <directory>                      Delete an empty archive directory\n  rm <file-id>                           Permanently delete a file and its Telegram parts\n  list [page]                            Browse every file by pages\n  exit                                   Close TGDisk\n\n  Examples:\n  upload \"C:\\My Files\\report.pdf\" --description \"Quarterly report\"\n  upload-folder \"C:\\My Files\\Photos\" --description \"Holiday archive\"\n  cd /C:/Users/mehra/Documents\n  ls\n");
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
    const startupDatabase = await getDatabase();
    const session = new StringSession(startupDatabase.data.session || "");
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
    startupDatabase.data.session = client.session.save();
    await startupDatabase.write();
    const websocketFlag = process.argv.indexOf("--ws");
    if (websocketFlag !== -1) {
        const requestedPort = process.argv[websocketFlag + 1];
        const port = requestedPort && /^\d+$/.test(requestedPort) ? Number(requestedPort) : 8787;
        if (port < 1 || port > 65535) throw new Error("WebSocket port must be between 1 and 65535.");
        startWebSocketServer({
            port,
            createSession: () => createCommandService({ client, key, getDatabase })
        });
        rl.close();
        console.log(`TGDisk WebSocket server listening on ws://127.0.0.1:${port}`);
        return;
    }
    showBanner();
    prompt();
})().catch((error) => {
    console.error(paint.red(`Startup failed: ${error.message}`));
    process.exitCode = 1;
});
