const crypto = require("node:crypto");
const dotenv = require("dotenv");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { JSONFilePreset } = require("lowdb/node");
const path = require("node:path");
const readline = require("node:readline");
const { Logger, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { downloadFile } = require("./lib/download");
const { uploadFile } = require("./lib/upload");

dotenv.config({ quiet: true });

const key = crypto.scryptSync(process.env.MASTER_PASSWORD, "tgdisk", 32);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let client;

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
    console.log(paint.dim("Telegram üzerinde güvenli dosya arşivi · help yazın\n"));
}

function showFiles(files) {
    if (files.length === 0) {
        console.log(paint.yellow("Arşivde dosya yok."));
        return;
    }
    console.log(paint.cyan("\n  ID  Dosya adı                                      Boyut"));
    console.log(paint.dim("  ──  ───────────────────────────────────────────── ─────────"));
    files.forEach((file, index) => {
        const name = file.name.length > 45 ? `${file.name.slice(0, 42)}...` : file.name;
        console.log(`  ${String(index).padStart(2)}  ${name.padEnd(45)} ${formatSize(file.size).padStart(9)}`);
    });
    console.log();
}

async function getDatabase() {
    return JSONFilePreset("db.json", { files: [] });
}

async function handleCommand(command) {
    const [cmd = "", ...args] = command.trim().split(/\s+/);
    const db = await getDatabase();

    switch (cmd.toLowerCase()) {
        case "upload": {
            const filePath = args.join(" ");
            if (!filePath) throw new Error("Kullanım: upload <dosya_yolu>");
            let latestProgress = -10;
            const entry = await uploadFile({
                client,
                filePath,
                key,
                onStage: (stage) => console.log(paint.cyan(`› ${stage}...`)),
                onProgress: (percent) => {
                    if (percent === 100 || percent - latestProgress >= 10) {
                        latestProgress = percent;
                        process.stdout.write(`\r${paint.dim(`  Yükleme: %${String(percent).padStart(3)}`)}`);
                    }
                }
            });
            process.stdout.write("\n");
            db.data.files.push(entry);
            await db.write();
            console.log(paint.green(`✓ Yüklendi ve arşive eklendi: ${entry.name} (${formatSize(entry.size)})`));
            break;
        }
        case "download": {
            if (!/^\d+$/.test(args[0] || "")) throw new Error("Kullanım: download <id>");
            const entry = db.data.files[Number(args[0])];
            if (!entry) throw new Error("Bu ID ile eşleşen dosya bulunamadı.");
            console.log(paint.cyan(`› İndiriliyor: ${entry.name}`));
            const outputPath = await downloadFile({
                client,
                fileEntry: entry,
                key,
                onProgress: (current, total) => process.stdout.write(`\r${paint.dim(`  Parça: ${current}/${total}`)}`)
            });
            process.stdout.write("\n");
            console.log(paint.green(`✓ İndirildi: ${outputPath}`));
            break;
        }
        case "list":
            showFiles(db.data.files);
            break;
        case "help":
            console.log("\n  upload <dosya_yolu>  Dosya yükle\n  download <id>         Dosyayı indir\n  list                  Arşivi listele\n  exit                  Programı kapat\n");
            break;
        case "exit":
        case "quit":
            console.log(paint.dim("Güle güle."));
            await client.disconnect();
            rl.close();
            return false;
        case "":
            break;
        default:
            throw new Error("Bilinmeyen komut. Komutları görmek için help yazın.");
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
        phoneNumber: () => new Promise((resolve) => rl.question("Telefon numarası: ", resolve)),
        password: () => new Promise((resolve) => rl.question("İki adımlı parola: ", resolve)),
        phoneCode: () => new Promise((resolve) => rl.question("Telegram kodu: ", resolve))
    });
    await fsp.writeFile("session.txt", client.session.save());
    showBanner();
    prompt();
})().catch((error) => {
    console.error(paint.red(`Başlatılamadı: ${error.message}`));
    process.exitCode = 1;
});
