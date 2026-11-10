HELPDESK SERAH TERIMA PAKET — UI/UX REFRESH

File yang perlu diganti di repository GitHub:
1. index.html
2. styles.css
3. app.js

Tidak perlu mengubah folder api/, lib/, package.json, vercel.json,
Code.gs, Environment Variables, Google Sheets, atau Google Drive.

Perubahan UI/UX:
- Menghilangkan hero besar dan instruksi panjang.
- Merapikan layar data utama dan layar Bagshield.
- Menampilkan ringkasan Bagshield/paket secara ringkas.
- Menyembunyikan keterangan resi opsional di dalam dropdown.
- Menjadikan daftar Bagshield tersimpan dapat dilipat.
- Memperbesar area input dan tombol agar nyaman di HP.
- Memakai font input 16px agar Chrome mobile tidak auto-zoom.
- Header tidak sticky di HP agar tidak memakan ruang saat keyboard muncul.

Perbaikan keyboard:
- Setelah scan kamera AWB, paket langsung ditambahkan tanpa memanggil focus()
  sehingga keyboard HP tidak muncul lagi otomatis.
- Setelah scan Bagshield, kolom tidak auto-focus.
- Setelah Bagshield disimpan, aplikasi tidak otomatis fokus ke kolom Bagshield.
- Setelah AWB ditambahkan dari scanner fisik dengan Enter, input AWB tetap aktif
  agar pemindaian berikutnya bisa langsung diterima.
- Aplikasi hanya memindahkan fokus ketika ada validasi yang memang memerlukan
  pengguna memperbaiki kolom.

Cara update via GitHub web:
1. Buka repository dan pilih branch main (atau branch yang akan diuji).
2. Buka file index.html, styles.css, dan app.js satu per satu.
3. Pilih Edit (ikon pensil), ganti seluruh isi file dengan file pengganti
   yang namanya sama, lalu Commit changes.
   Alternatif: Add file > Upload files, setelah mengekstrak ZIP di laptop.
4. Pastikan ketiga file masuk ke root repository, bukan ke subfolder.
5. Setelah ketiganya ter-commit, tunggu Vercel deployment menjadi Ready.
6. Buka website dan refresh dengan Ctrl+Shift+R.

Catatan:
- Jangan mengganti Code.gs atau backend API untuk pembaruan UI ini.
- Untuk test scan kamera, gunakan website HTTPS dari Vercel dan beri izin kamera.
