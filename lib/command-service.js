const path = require("node:path");
const { parseUploadArguments } = require("./command");
const { deleteArchiveFile } = require("./delete");
const { downloadFile } = require("./download");
const { directoryExists, ensureDirectory, listDirectory, localDirectoryToVirtualPath, normalizeVirtualPath, removeEmptyDirectory } = require("./filesystem");
const { collectFiles, uploadDirectory } = require("./folder-upload");
const { uploadFile } = require("./upload");

// This is the UI-neutral application boundary.  A terminal, a WebSocket client,
// or a future GUI supplies the small interaction adapter passed to execute().
function createCommandService({ client, key, getDatabase }) {
    let currentDirectory = "/";

    async function execute(command, interaction = {}) {
        const emit = interaction.emit || (() => {});
        const ask = interaction.ask || (async () => "");
        const trimmed = String(command || "").trim();
        const firstWhitespace = trimmed.search(/\s/);
        const name = (firstWhitespace === -1 ? trimmed : trimmed.slice(0, firstWhitespace)).toLowerCase();
        const argumentsText = firstWhitespace === -1 ? "" : trimmed.slice(firstWhitespace).trim();
        const db = await getDatabase();

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
                await db.write();
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
                        await db.write();
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
                return { files: db.data.files.slice((page - 1) * 50, page * 50), page, pageCount, total: db.data.files.length };
            }
            case "ls": {
                const target = normalizeVirtualPath(argumentsText || ".", currentDirectory);
                if (!directoryExists(db, target)) throw new Error(`Directory does not exist: ${target}`);
                return { directory: target, ...listDirectory(db, target) };
            }
            case "cd": {
                if (!argumentsText) throw new Error("Usage: cd <directory>");
                const target = normalizeVirtualPath(argumentsText, currentDirectory);
                if (!directoryExists(db, target)) throw new Error(`Directory does not exist: ${target}`);
                currentDirectory = target;
                return { directory: currentDirectory };
            }
            case "pwd": return { directory: currentDirectory };
            case "mkdir": {
                if (!argumentsText) throw new Error("Usage: mkdir <directory>");
                const directory = ensureDirectory(db, normalizeVirtualPath(argumentsText, currentDirectory));
                await db.write();
                return { message: "Directory created.", directory };
            }
            case "rmdir": {
                if (!argumentsText) throw new Error("Usage: rmdir <directory>");
                const directory = normalizeVirtualPath(argumentsText, currentDirectory);
                const confirmed = await ask({ type: "confirm", message: `Delete empty directory '${directory}'?`, defaultValue: false });
                if (!isConfirmed(confirmed)) return { cancelled: true, message: "Deletion cancelled." };
                removeEmptyDirectory(db, directory);
                await db.write();
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
                await db.write();
                return { message: "File deleted.", file };
            }
            case "help": return { commands: ["upload", "upload-folder", "download", "list", "ls", "cd", "pwd", "mkdir", "rmdir", "rm"] };
            case "": return {};
            default: throw new Error("Unknown command. Type help to see available commands.");
        }
    }

    return { execute, getCurrentDirectory: () => currentDirectory };
}

function isConfirmed(value) {
    return value === true || String(value).trim().toLowerCase() === "y";
}

module.exports = { createCommandService };
