const fsp = require("node:fs/promises");
const path = require("node:path");
const { normalizeVirtualPath } = require("./filesystem");
const { uploadFile } = require("./upload");

async function collectFiles(directoryPath) {
    const root = path.resolve(directoryPath);
    const stats = await fsp.stat(root);
    if (!stats.isDirectory()) throw new Error("The supplied path is not a directory.");

    const files = [];
    async function visit(currentPath) {
        const entries = await fsp.readdir(currentPath, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) await visit(entryPath);
            else if (entry.isFile()) files.push(entryPath);
        }
    }
    await visit(root);
    return { root, files };
}

async function uploadDirectory({ client, files, rootDirectory, destinationDirectory, key, description, onFile }) {
    const relativeBase = path.dirname(rootDirectory);
    const uploaded = [];
    for (let index = 0; index < files.length; index++) {
        const filePath = files[index];
        const entry = await uploadFile({ client, filePath, key, description });
        const relativePath = path.relative(relativeBase, filePath).replaceAll("\\", "/");
        entry.virtualPath = normalizeVirtualPath(relativePath, destinationDirectory);
        uploaded.push(entry);
        await onFile?.(entry, index + 1, files.length, relativePath);
    }
    return uploaded;
}

module.exports = { collectFiles, uploadDirectory };
