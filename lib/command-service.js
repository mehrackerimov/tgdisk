const path = require("node:path");
const { parseUploadArguments } = require("./command");
const { deleteArchiveFile } = require("./delete");
const { downloadFile } = require("./download");
const { directoryExists, ensureDirectory, listDirectory, localDirectoryToVirtualPath, normalizeVirtualPath, removeEmptyDirectory } = require("./filesystem");
const { collectFiles, uploadDirectory } = require("./folder-upload");
const { uploadFile } = require("./upload");

// This is the UI-neutral application boundary.  A terminal, a WebSocket client,
// or a future GUI supplies the small interaction adapter passed to execute().
function createCommandService({ client, key, getDatabase, saveDatabase }) {
    let currentDirectory = "/";

    async function execute(command, interaction = {}) {
        const emit = interaction.emit || (() => {});
        const ask = interaction.ask || (async () => "");
        const trimmed = String(command || "").trim();
        const firstWhitespace = trimmed.search(/\s/);
        const name = (firstWhitespace === -1 ? trimmed : trimmed.slice(0, firstWhitespace)).toLowerCase();
        const argumentsText = firstWhitespace === -1 ? "" : trimmed.slice(firstWhitespace).trim();
        const db = await getDatabase();
        const save = saveDatabase || ((database) => database.write());

        switch (name) {
            case "upload": {
                const { filePath, description } = parseUploadArguments(argumentsText);
                const defaultDirectory = currentDirectory === "/" ? localDirectoryToVirtualPath(filePath) : currentDirectory;
                const answer = await ask({ type: "destination", message: "Destination folder", defaultValue: defaultDirectory });
                const destinationDirectory = normalizeVirtualPath(answer || defaultDirectory, currentDirectory);
                let latestProgress = 0;
                const entry = await uploadFile({
                    client, filePath, key, description,
                    onStage: (stage) => emit({ type: "stage", stage }),
                    onProgress: (percent) => {
                        if (percent === 100 || percent - latestProgress >= 10) {
                            latestProgress = percent;
                            emit({ type: "progress", operation: "upload", percent });
                        }
                    }
                });
                entry.virtualPath = ensureDirectory(db, destinationDirectory);
                db.data.files.push(entry);
                await save(db);
                return { message: "File uploaded.", file: entry };
            }
            case "upload-folder": {
                const { filePath: directoryPath, description } = parseUploadArguments(argumentsText);
                const { root, files } = await collectFiles(directoryPath);
                if (files.length === 0) throw new Error("The selected directory contains no files.");
                const defaultDirectory = currentDirectory === "/" ? localDirectoryToVirtualPath(root) : currentDirectory;
                const destinationAnswer = await ask({ type: "destination", message: "Destination folder", defaultValue: defaultDirectory });
                const destinationDirectory = normalizeVirtualPath(destinationAnswer || defaultDirectory, currentDirectory);
                const confirmed = await ask({ type: "confirm", message: `Upload ${files.length} file(s) from '${root}'?`, defaultValue: false });
                if (!isConfirmed(confirmed)) return { cancelled: true, message: "Upload cancelled." };
                await uploadDirectory({
                    client, files, rootDirectory: root, destinationDirectory, key, description,
                    onFile: async (entry, current, total, relativePath) => {
                        entry.virtualPath = ensureDirectory(db, path.posix.dirname(entry.virtualPath));
                        db.data.files.push(entry);
                        await save(db);
                        emit({ type: "progress", operation: "upload-folder", current, total, file: relativePath });
                    }
                });
                return { message: "Folder uploaded.", count: files.length };
            }
            case "download": {
                if (!/^\d+$/.test(argumentsText)) throw new Error("Usage: download <id>");
                const entry = db.data.files[Number(argumentsText)];
                if (!entry) throw new Error("No file exists with this ID.");
                const outputPath = await downloadFile({
                    client, fileEntry: entry, key,
                    onProgress: (current, total) => emit({ type: "progress", operation: "download", current, total })
                });
                return { message: "File downloaded.", outputPath };
            }
            case "list": {
                if (argumentsText && !/^\d+$/.test(argumentsText)) throw new Error("Usage: list [page]");
                const page = Number(argumentsText || 1);
                const pageCount = Math.max(1, Math.ceil(db.data.files.length / 50));
                if (page < 1 || page > pageCount) throw new Error(`Choose a page between 1 and ${pageCount}.`);
                const start = (page - 1) * 50;
                return { files: db.data.files.slice(start, start + 50).map((file, index) => ({ id: start + index, ...file })), page, pageCount, total: db.data.files.length };
            }
            case "ls": {
                const target = normalizeVirtualPath(argumentsText || ".", currentDirectory);
                if (!directoryExists(db, target)) throw new Error(`Directory does not exist: ${target}`);
                const contents = listDirectory(db, target);
                return { directory: target, folders: contents.folders, files: contents.files.map((file) => ({ id: db.data.files.indexOf(file), ...file })) };
            }
            case "cd": {
                if (!argumentsText) throw new Error("Usage: cd <directory>");
                const target = normalizeVirtualPath(argumentsText, currentDirectory);
                if (!directoryExists(db, target)) throw new Error(`Directory does not exist: ${target}`);
                currentDirectory = target;
                return { directory: currentDirectory };
            }
            case "pwd": return { directory: currentDirectory };
            case "info": {
                const fileId = parseFileId(argumentsText, "Usage: info <file-id>");
                const file = db.data.files[fileId];
                if (!file) throw new Error("No file exists with this ID.");
                return { id: fileId, file };
            }
            case "find": {
                if (!argumentsText) throw new Error("Usage: find <text>");
                const query = argumentsText.toLocaleLowerCase();
                const files = db.data.files
                    .map((file, id) => ({ id, ...file }))
                    .filter((file) => [file.name, file.description, file.virtualPath].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
                return { query: argumentsText, files, total: files.length };
            }
            case "mv": {
                const { fileId, destination } = parseMoveArguments(argumentsText);
                const file = db.data.files[fileId];
                if (!file) throw new Error("No file exists with this ID.");
                file.virtualPath = ensureDirectory(db, normalizeVirtualPath(destination, currentDirectory));
                await save(db);
                return { message: "File moved.", id: fileId, file };
            }
            case "mkdir": {
                if (!argumentsText) throw new Error("Usage: mkdir <directory>");
                const directory = ensureDirectory(db, normalizeVirtualPath(argumentsText, currentDirectory));
                await save(db);
                return { message: "Directory created.", directory };
            }
            case "rmdir": {
                if (!argumentsText) throw new Error("Usage: rmdir <directory>");
                const directory = normalizeVirtualPath(argumentsText, currentDirectory);
                const confirmed = await ask({ type: "confirm", message: `Delete empty directory '${directory}'?`, defaultValue: false });
                if (!isConfirmed(confirmed)) return { cancelled: true, message: "Deletion cancelled." };
                removeEmptyDirectory(db, directory);
                await save(db);
                if (currentDirectory === directory) currentDirectory = "/";
                return { message: "Directory deleted.", directory };
            }
            case "rm": {
                if (!/^\d+$/.test(argumentsText)) throw new Error("Usage: rm <file-id>");
                const fileId = Number(argumentsText);
                const file = db.data.files[fileId];
                if (!file) throw new Error("No file exists with this ID.");
                const confirmed = await ask({ type: "confirm", message: `Permanently delete '${file.name}' from Telegram and the archive?`, defaultValue: false });
                if (!isConfirmed(confirmed)) return { cancelled: true, message: "Deletion cancelled." };
                await deleteArchiveFile({ client, database: db, fileId });
                await save(db);
                return { message: "File deleted.", file };
            }
            case "help": return { commands: ["upload", "upload-folder", "download", "list", "ls", "cd", "pwd", "info", "find", "mv", "mkdir", "rmdir", "rm"] };
            case "": return {};
            default: throw new Error("Unknown command. Type help to see available commands.");
        }
    }

    return { execute, getCurrentDirectory: () => currentDirectory };
}

function isConfirmed(value) {
    return value === true || String(value).trim().toLowerCase() === "y";
}

function parseFileId(value, usage) {
    if (!/^\d+$/.test(value)) throw new Error(usage);
    return Number(value);
}

function parseMoveArguments(value) {
    const match = /^(\d+)\s+(.+)$/.exec(value);
    if (!match) throw new Error("Usage: mv <file-id> <directory>");
    return { fileId: Number(match[1]), destination: match[2] };
}

module.exports = { createCommandService };
