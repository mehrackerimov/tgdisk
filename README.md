# TGDisk

TGDisk is a command-line personal archive that stores files in your Telegram **Saved Messages**. Files are compressed with gzip, encrypted locally with AES-256-GCM, and then uploaded as Telegram documents. The encryption password never leaves your computer.

It behaves like a small virtual disk: create archive folders, move between them with `cd`, inspect them with `ls`, attach optional file descriptions, and download or permanently remove files when needed. Archive metadata, including virtual paths and Telegram message IDs, is stored locally in `db.json`.

> [!WARNING]
> Keep both your `MASTER_PASSWORD` and `db.json` safe. The password is required to decrypt files, and `db.json` maps archive records to the Telegram messages that contain their encrypted data. Do not commit either file to a public repository.

## Features

- Client-side gzip compression and AES-256-GCM encryption.
- Secure authentication checks before a downloaded file is restored.
- Automatic multipart uploads when encrypted data exceeds 200 MB.
- Virtual archive folders saved in `db.json`.
- File descriptions and paginated global archive listing.
- Safe deletion: files require confirmation and remove all of their Telegram parts; directories can only be deleted when empty.
- Quiet Telegram client logs and readable command-line progress output.

## Requirements

- Node.js 18 or newer.
- A Telegram account.
- Telegram API credentials (`APP_ID` and `API_HASH`).

## Installation

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/mehrackerimov/tgdisk.git
   cd tgdisk
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your local environment file from the example:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Edit `.env` and set all three values:

   ```env
   MASTER_PASSWORD=use-a-long-unique-password
   APP_ID=12345678
   API_HASH=your_telegram_api_hash
   ```

5. Start TGDisk:

   ```bash
   node main.js
   ```

On the first launch, TGDisk asks for your Telegram phone number and login code. If you enabled Telegram two-step verification, it also asks for that password. A local `session.txt` file is then created so you normally do not have to sign in again.

## Getting Telegram API Credentials

TGDisk uses Telegram's official client API credentials, which are different from a bot token.

1. Open [my.telegram.org](https://my.telegram.org) in a browser.
2. Sign in with the phone number attached to the Telegram account you want to use.
3. Select **API development tools**.
4. Create an application. The application title and short name can be any sensible values, for example `TGDisk` and `tgdisk`.
5. Copy the displayed **api_id** into `APP_ID` and **api_hash** into `API_HASH` in your `.env` file.

Treat `API_HASH` like a password. Never share it or add it to source control.

## Commands

Run `help` inside TGDisk to see the available commands.

| Command | Description |
| --- | --- |
| `upload <path> [--description <text>]` | Upload a file. TGDisk asks for its virtual archive folder. |
| `download <id>` | Restore a file by its global file ID. |
| `ls [directory]` | Show folders and files in the current archive directory. |
| `cd <directory>` | Change the current virtual archive directory. Supports `.` and `..`. |
| `pwd` | Print the current virtual archive directory. |
| `mkdir <directory>` | Create a virtual archive directory, including missing parent folders. |
| `rmdir <directory>` | Delete an empty virtual archive directory after confirmation. |
| `rm <file-id>` | Permanently delete an archive file and all its Telegram parts after confirmation. |
| `list [page]` | Browse all files in pages of 50. Useful for very large archives. |
| `exit` | Close TGDisk. |

### Examples

Upload a file with spaces in its path and a description:

```text
upload "C:\Users\me\Documents\Quarterly Report.pdf" --description "Q2 finance report"
```

When asked for the destination folder, press Enter to use the current virtual folder. If you are at archive root, pressing Enter uses the source file's computer directory as the initial virtual path.

Navigate the archive:

```text
mkdir projects
cd projects
upload "C:\work\demo.zip" --description "Demo build"
ls
pwd
```

Browse a large archive without printing every record at once:

```text
list 1
list 2
```

## Storage Format and Multipart Files

For each upload, TGDisk creates this encrypted payload structure:

```text
12-byte IV + AES-256-GCM ciphertext of gzip data + 16-byte authentication tag
```

Encrypted payloads larger than 200 MB are split into sequential Telegram documents. The `parts` array in `db.json` stores each part's order, Telegram message ID, and size. On download, TGDisk fetches them in order, verifies the authentication tag, and decompresses only after successful verification.

## Data Files

- `.env` — local API credentials and encryption password. Keep private.
- `session.txt` — reusable Telegram login session. Keep private.
- `db.json` — archive metadata: filenames, virtual paths, descriptions, and Telegram message IDs. Back it up securely.

The project ignores these files through `.gitignore`. Losing `db.json` does not delete Telegram data, but it removes the local index required to find and restore it.

## Testing

Run the automated test suite with:

```bash
npm test
```

The tests cover encryption and authentication, multipart upload ordering, download restoration, command parsing for quoted and whitespace-containing paths, virtual filesystem behavior, and deletion behavior.

## Security Notes

- Use a long, unique `MASTER_PASSWORD` and store it in a password manager.
- Do not edit encrypted records in `db.json` manually.
- Older archive records created before TGDisk stored the IV and authentication tag cannot be decrypted safely. Upload files again to create current-format records.
- Telegram account and storage limits still apply.
