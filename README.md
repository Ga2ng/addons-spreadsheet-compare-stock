# Add-ons Spreadsheet SO

Project Google Spreadsheet Add-on yang terintegrasi dengan **Google Apps Script** menggunakan **clasp**.

## Struktur Folder
```text
addons-spreadsheet-SO/
├── 00-manifest/
│   └── appsscript.json     # Manifest Google Apps Script & OAuth Scopes
├── 01-code-backend/
│   └── Code.gs             # Menu Add-on & fungsi backend Google Apps Script
├── 02-sidebar-ui/
│   └── Sidebar.html        # UI HTML Sidebar polosan
├── dist-clasp/             # Target build untuk push clasp (otomatis)
├── scripts/
│   └── build.js            # Script sync ke dist-clasp
├── .clasp.json             # Konfigurasi Script ID Google Apps Script
├── package.json
└── README.md
```

## Cara Menghubungkan ke Google Spreadsheet

### Opsi A: Jika Spreadsheet Baru / Belum ada Script
1. Login clasp:
   ```bash
   npm run login
   ```
2. Buat script container-bound langsung ke spreadsheet Anda:
   ```bash
   npx @google/clasp create --title "Add-on SO" --type sheets --parentId "<ID_SPREADSHEET_ANDA>" --rootDir ./dist-clasp
   ```

### Opsi B: Jika Sudah Punya Script di Spreadsheet (Extensions > Apps Script)
1. Buka spreadsheet Anda -> **Extensions** > **Apps Script**.
2. Buka **Project Settings** (ikon gear ⚙️ di kiri).
3. Salin **Script ID**.
4. Tempel Script ID ke file `.clasp.json`:
   ```json
   {
     "scriptId": "<TEMPEL_SCRIPT_ID_DISINI>",
     "rootDir": "./dist-clasp"
   }
   ```

### Deploy / Push Kode
Tinggal jalankan:
```bash
npm run push
```
Script otomatis melakukan build/sync dari `00-manifest`, `01-code-backend`, dan `02-sidebar-ui` ke `dist-clasp/` lalu mengunggahnya ke Apps Script.
