# Helpdesk Serah Terima Paket — GitHub + Vercel

Website mobile responsif untuk pencatatan Bagshield dan paket saat serah terima. Frontend di-host oleh Vercel, API berjalan sebagai Vercel Functions, dan data disimpan ke Google Sheets serta foto ke Google Drive.

## Fitur

- Form data utama: tanggal pengiriman, nama petugas, HUB Pengirim.
- Scan barcode Bagshield dan AWB menggunakan kamera belakang.
- Mendukung barcode scanner USB/Bluetooth yang bertindak sebagai keyboard.
- Paket ber-resi: nomor AWB wajib, catatan dan foto opsional.
- Paket tanpa resi: foto bukti dan ciri-ciri fisik wajib.
- Simpan sementara per Bagshield, tambah banyak Bagshield, revisi, dan hapus sebelum finalisasi.
- Draft tersimpan di IndexedDB pada perangkat/browser yang digunakan.
- Foto dikompres pada perangkat lalu diunggah ke folder Google Drive.
- Rekap satu baris per Bagshield dan detail satu baris per paket di Google Sheets.
- Download Excel dengan sheet Rekap Bagshield dan Detail Paket.
- API dilindungi kode akses bersama (`APP_ACCESS_PIN`).

## Struktur proyek

```text
helpdesk-vercel/
├── api/
│   ├── health.js
│   ├── upload-photo.js
│   └── save-report.js
├── lib/
│   └── google.js
├── index.html
├── styles.css
├── app.js
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

## A. Siapkan Google Sheets dan Google Drive

1. Buat satu Google Spreadsheet baru. Salin ID spreadsheet dari URL:
   `https://docs.google.com/spreadsheets/d/ID_SPREADSHEET/edit`
2. Buat atau gunakan **Shared Drive perusahaan** (Drive Bersama), lalu buat folder khusus foto bukti di dalam Shared Drive tersebut. Salin ID folder dari URL:
   `https://drive.google.com/drive/folders/ID_FOLDER`
3. Tambahkan alamat `client_email` Service Account sebagai anggota Shared Drive dengan peran yang dapat menambahkan file (misalnya Contributor). Folder foto harus berada di Shared Drive, bukan My Drive biasa. Service Account tidak memiliki kuota Drive dan tidak dapat memiliki file di My Drive. Jika organisasi tidak mempunyai Shared Drive, diperlukan varian autentikasi OAuth atas akun Google pengguna.
4. Nama tab `REKAP_BAGSHIELD` dan `DETAIL_PAKET` akan dibuat otomatis oleh backend jika belum ada. Jangan membuat header sendiri dengan urutan berbeda.

## B. Buat Google Service Account

1. Buka Google Cloud Console dan buat/pilih project.
2. Aktifkan **Google Sheets API** dan **Google Drive API** pada project tersebut.
3. Buat Service Account, lalu buat key dengan format JSON.
4. Unduh file JSON tersebut ke laptop. Jangan unggah file ini ke GitHub dan jangan kirim isinya ke chat.
5. Buka file JSON secara lokal dan salin nilai `client_email`.
6. Bagikan Google Spreadsheet kepada alamat `client_email` tersebut sebagai **Editor**.
7. Pastikan Service Account sudah menjadi anggota Shared Drive dan dapat menambahkan file ke folder foto.
8. Untuk membuka tautan foto dari akun petugas, pastikan akun atau grup Google perusahaan yang berhak melihat bukti menjadi anggota Shared Drive. Jangan mengubah foto menjadi publik kecuali kebijakan perusahaan memang mengizinkannya.

## C. Encode Service Account JSON ke Base64 (Windows PowerShell)

Sesuaikan lokasi file JSON yang diunduh, kemudian jalankan perintah berikut pada PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\service-account.json"))
```

Salin hasil Base64. Hasil ini digunakan sebagai nilai Environment Variable Vercel, bukan dimasukkan ke file JavaScript.

## D. Upload proyek ke GitHub

1. Buat repository GitHub baru, misalnya `helpdesk-serah-terima-paket`.
2. Upload seluruh isi folder proyek ini ke root repository (pastikan `index.html`, `app.js`, `styles.css`, `package.json`, `vercel.json`, folder `api`, dan folder `lib` berada di root repository).
3. Jangan mengunggah file JSON Service Account atau file `.env`.
4. Pastikan repository berisi `.gitignore` yang disediakan.

## E. Hubungkan GitHub ke Vercel

1. Masuk ke Vercel dan pilih **Add New → Project**.
2. Import repository GitHub yang sudah dibuat.
3. Framework preset: **Other**.
4. Build command: kosongkan (proyek ini tidak memerlukan build step).
5. Output directory: biarkan default/root.
6. Sebelum deploy atau sesudah membuat project, buka **Settings → Environment Variables**.
7. Tambahkan variable berikut untuk Production (tambahkan Preview juga bila diperlukan):

| Variable | Nilai |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Hasil Base64 file JSON Service Account |
| `GOOGLE_SPREADSHEET_ID` | ID Google Spreadsheet |
| `GOOGLE_DRIVE_FOLDER_ID` | ID folder Google Drive foto |
| `APP_ACCESS_PIN` | Kode akses bersama untuk petugas, contoh format 6–10 karakter unik |

8. Simpan Environment Variables, lalu lakukan Deploy / Redeploy.
9. Buka URL Vercel. Masukkan `APP_ACCESS_PIN` saat diminta.

Vercel hanya membaca perubahan Environment Variables pada deployment baru, jadi lakukan Redeploy setelah mengubah nilainya.

## F. Uji coba awal

Gunakan satu laporan uji:

1. Isi tanggal, nama petugas, dan HUB Pengirim.
2. Scan/input Bagshield pertama.
3. Tambahkan satu AWB ber-resi.
4. Pilih mode **Tidak Ada Resi**, isi ciri-ciri paket, lalu ambil foto.
5. Klik **Simpan Sementara Bagshield**.
6. Tambahkan Bagshield kedua jika diperlukan.
7. Klik **Finalisasi & Download Excel**.
8. Pastikan baris Bagshield masuk ke `REKAP_BAGSHIELD`, baris paket masuk ke `DETAIL_PAKET`, dan foto muncul di folder Drive.
9. Pastikan file Excel berisi dua sheet.

## Catatan penting

- Kamera barcode browser memerlukan HTTPS dan izin kamera. URL produksi Vercel menggunakan HTTPS.
- Scanner USB/Bluetooth yang mengetikkan hasil scan seperti keyboard dapat digunakan pada kolom Bagshield/AWB.
- Draft tersimpan pada IndexedDB browser/perangkat yang sedang dipakai. Draft tidak otomatis berpindah ke perangkat lain dan dapat hilang jika data situs/browser dihapus.
- Foto yang diunggah masuk ke folder di Shared Drive perusahaan. Akses tautannya mengikuti izin Shared Drive/folder; backend tidak membuat foto menjadi publik. Service Account tidak dapat mengunggah ke My Drive pribadi biasa tanpa OAuth atas akun manusia atau domain-wide delegation.
- `APP_ACCESS_PIN` adalah kode bersama tim, bukan akun pengguna individual. Untuk kebutuhan audit per petugas, tambahkan login Google/OAuth dan role akses pada iterasi berikutnya.
- Uji dengan data non-produksi terlebih dahulu. Integrasi Google baru benar-benar aktif setelah Service Account, izin spreadsheet/folder, dan Environment Variables disetel dengan benar.
- API melakukan penggantian baris berdasarkan `reportId` sehingga pengiriman ulang dari draft yang sama tidak menambah baris duplikat untuk laporan tersebut. Hindari dua admin mengubah laporan yang sama pada waktu bersamaan.

## Local test

Memerlukan Node.js 22 dan npm:

```bash
npm install
npx vercel dev
```

Buat `.env` lokal berdasarkan `.env.example` dan isi semua variable yang diperlukan sebelum menjalankan `vercel dev`.
