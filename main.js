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

dotenv.config();


const key = crypto.scryptSync(process.env.MASTER_PASSWORD, "tgdisk", 32);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

let stringSession = new StringSession("");

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

    await pipeline(
        fs.createReadStream(compressedPath),
        cipher,
        fs.createWriteStream(encryptedPath)
    );

    const authTag = cipher.getAuthTag();

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
        algorithm: "zstd",
        encrypted: true,
        cipher: "aes-256-gcm",
        parts
    };
}

function prompt() {
    rl.question("> ", async (command) => {
        const args = command.trim().split(" ");
        const cmd = args.shift()?.toLowerCase();

        switch (cmd) {
            case "upload":
                const filePath = args.join(" ");
                const upload_data = await upload_file(filePath);
                
                const db = await JSONFilePreset("db.json", {
                    files: []
                });


                if (upload_data) {
                    db.data.files.push(upload_data);
                    await db.write();
                }

                break;

            case "download":
                console.log("Download:", args.join(" "));
                break;

            case "list":
                const files = await db.getData("/files/");

                for (let index = 0; index < files.length; index++) {
                    const file = files[index];
                    console.log(file)
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


