function removeWrappingQuotes(value) {
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        return value.slice(1, -1);
    }
    return value;
}

function findDescriptionFlag(text) {
    let quote = null;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === '"' || character === "'") {
            quote = quote === character ? null : (quote || character);
            continue;
        }
        if (!quote && text.startsWith("--description", index)) {
            const previousIsBoundary = index === 0 || /\s/.test(text[index - 1]);
            const nextIndex = index + "--description".length;
            const nextIsBoundary = nextIndex === text.length || /\s/.test(text[nextIndex]);
            if (previousIsBoundary && nextIsBoundary) return { start: index, end: nextIndex };
        }
    }
    return null;
}

function parseUploadArguments(argumentText) {
    const descriptionFlag = findDescriptionFlag(argumentText);
    const pathText = (descriptionFlag ? argumentText.slice(0, descriptionFlag.start) : argumentText).trim();
    const descriptionText = descriptionFlag ? argumentText.slice(descriptionFlag.end).trim() : "";
    const filePath = removeWrappingQuotes(pathText);
    const description = removeWrappingQuotes(descriptionText);

    if (!filePath) throw new Error("Usage: upload <file path> [--description <text>]");
    if (description.length > 500) throw new Error("Description must be 500 characters or fewer.");
    return { filePath, description };
}

module.exports = { parseUploadArguments };
