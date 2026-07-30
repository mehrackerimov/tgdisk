const path = require("node:path");

function normalizeVirtualPath(input = ".", currentDirectory = "/") {
    let value = String(input).trim().replaceAll("\\", "/");
    if (/^[a-zA-Z]:\//.test(value)) value = `/${value}`;
    const resolved = value.startsWith("/") ? value : path.posix.join(currentDirectory, value || ".");
    const normalized = path.posix.normalize(resolved);
    return normalized === "." ? "/" : normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function localDirectoryToVirtualPath(filePath) {
    return normalizeVirtualPath(path.dirname(path.resolve(filePath)));
}

function ensureDirectory(database, directoryPath) {
    database.data.directories ||= [];
    const target = normalizeVirtualPath(directoryPath);
    const segments = target.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
        current += `/${segment}`;
        if (!database.data.directories.includes(current)) database.data.directories.push(current);
    }
    return target;
}

function directoryExists(database, directoryPath) {
    const target = normalizeVirtualPath(directoryPath);
    return target === "/" || (database.data.directories || []).includes(target);
}

function listDirectory(database, directoryPath) {
    const current = normalizeVirtualPath(directoryPath);
    const prefix = current === "/" ? "/" : `${current}/`;
    const folders = new Set();

    for (const directory of database.data.directories || []) {
        if (!directory.startsWith(prefix) || directory === current) continue;
        const remainder = directory.slice(prefix.length);
        if (remainder && !remainder.includes("/")) folders.add(directory);
    }

    const files = (database.data.files || []).filter((file) => normalizeVirtualPath(file.virtualPath || "/") === current);
    return { folders: [...folders].sort(), files };
}

module.exports = { directoryExists, ensureDirectory, listDirectory, localDirectoryToVirtualPath, normalizeVirtualPath };
