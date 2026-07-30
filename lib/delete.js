async function deleteArchiveFile({ client, database, fileId }) {
    if (!Number.isInteger(fileId) || fileId < 0 || fileId >= database.data.files.length) {
        throw new Error("No file exists with this ID.");
    }
    const file = database.data.files[fileId];
    const messageIds = file.parts?.map((part) => part.messageId).filter(Number.isInteger) || [];
    if (messageIds.length === 0) throw new Error("The file record has no Telegram message IDs.");

    await client.deleteMessages("me", messageIds, { revoke: true });
    database.data.files.splice(fileId, 1);
    return file;
}

module.exports = { deleteArchiveFile };
