const dotenv = require("dotenv");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const readline = require("readline");
const fs = require("fs");
const fsp = require("fs/promises");
const zlib = require("node:zlib");
const { pipeline } = require("stream/promises");
const path = require("path");
const crypto = require("crypto");
const { JSONFilePreset } = require("lowdb/node")
const { downloadFile, ENCRYPTION_FORMAT } = require("./lib/download");

dotenv.config();


const key = crypto.scryptSync(process.env.MASTER_PASSWORD, "tgdisk", 32);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

let stringSession = new StringSession("");

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

async function upload_file(filePath) {
    if (!fs.existsSync(filePath)) {
        return console.log("[ERROR] File not found.");
    }

    const compressedPath = `${filePath}.gz`;

    const stats = await fsp.stat(filePath);


    await pipeline(
        fs.createReadStream(filePath),
        zlib.createGzip({
            level: 9
        }),
        fs.createWriteStream(compressedPath)
    );

    console.log("[INFO] Compression completed.");

    const encryptedPath = `${compressedPath}.enc`;
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        key,
        iv
    );

    fs.writeFileSync(encryptedPath, iv);

    await pipeline(
        fs.createReadStream(compressedPath),
        cipher,
        fs.createWriteStream(encryptedPath, { flags: 'a' })
    );

    const authTag = cipher.getAuthTag();
    fs.appendFileSync(encryptedPath, authTag);

    console.log("[INFO] Encryption completed.");

    let parts = [];


    const message = await global.client.sendFile("me", {
        file: encryptedPath,
        forceDocument: true
    });

    parts.push({
        part: 0,
        messageId: message.id,
        size: fs.statSync(encryptedPath).size
    });

    return {
        name: path.basename(filePath),
        size: stats.size,
        compressed: true,
        compression: "gzip",
        encrypted: true,
        cipher: "aes-256-gcm",
        encryptionFormat: ENCRYPTION_FORMAT,
        parts
    };
}

function prompt() {
    rl.question("> ", async (command) => {
        const args = command.trim().split(" ");
        const cmd = args.shift()?.toLowerCase();

        const db = await JSONFilePreset("db.json", {
            files: []
        });

        switch (cmd) {
            case "upload":
                const filePath = args.join(" ");
                const upload_data = await upload_file(filePath);

                if (upload_data) {
                    db.data.files.push(upload_data);
                    await db.write();
                }

                break;

            case "download":
                try {
                    if (!/^\d+$/.test(args[0] || "")) {
                        throw new Error("Geçerli bir dosya ID'si girin.");
                    }
                    const fileEntry = db.data.files[Number(args[0])];
                    if (!fileEntry) {
                        throw new Error("Dosya bulunamadı.");
                    }
                    const outputPath = await downloadFile({
                        client: global.client,
                        fileEntry,
                        key,
                        onProgress: (current, total) => console.log(`[INFO] Parça indirildi: ${current}/${total}`)
                    });
                    console.log(`[INFO] İndirildi: ${outputPath}`);
                } catch (e) {
                    console.error(`[ERROR] İndirme başarısız: ${e.message}`);
                }
                break;

            case "list":

                for (const file of db.data.files) {
                    console.log(`ID: ${db.data.files.indexOf(file)} | ${file.name.padEnd(30)} | ${formatSize(file.size).padStart(10)} |`);
                }

                break;

            case "help":
                console.log(`
Komutlar:
  upload <file_path>
  download <id>
  list
  exit
                `);
                break;

            case "exit":
                console.log("Çıkılıyor...");
                rl.close();
                process.exit(0);

            default:
                console.log("Bilinmeyen komut.");
        }

        prompt();
    });
}


(async () => {
    console.log("Loading telegram client...");

    if (!fs.existsSync("session.txt")) {
        fs.writeFileSync("session.txt", "");
    } else {
        const sessionKey = await fsp.readFile("session.txt", "utf8");
        stringSession = new StringSession(sessionKey);
    };

    const client = global.client = new TelegramClient(stringSession, Number(process.env.APP_ID), process.env.API_HASH, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () =>
            new Promise((resolve) =>
                rl.question("Please enter your number: ", resolve)
            ),
        password: async () =>
            new Promise((resolve) =>
                rl.question("Please enter your password: ", resolve)
            ),
        phoneCode: async () =>
            new Promise((resolve) =>
                rl.question("Please enter the code you received: ", resolve)
            ),
    });

    console.log("You should now be connected.");

    fs.writeFileSync("session.txt", client.session.save());

    console.log("TGDisk CLI");
    prompt();
})();


