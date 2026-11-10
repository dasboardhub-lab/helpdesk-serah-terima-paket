(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const DB_NAME = 'HelpdeskPaketVercel';
  const DB_VERSION = 1;
  const DB_STORE = 'drafts';

  let db = null;
  let accessPin = '';
  let appInfo = null;
  let scanner = null;
  let scannerTarget = '';
  let scannerLocked = false;
  let toastTimer = null;
  let busy = false;
  let photoDataUrl = '';
  let packageMode = 'hasResi';
  let lastSavedReport = null;

  function makeId(prefix) {
    const raw = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return `${prefix}_${raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}`;
  }

  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function setConnection(status, message) {
    const el = $('connectionBadge');
    el.className = `connection-badge ${status}`;
    el.innerHTML = `<i></i>${escapeHtml(message)}`;
  }

  function getFreshState() {
    return {
      reportId: makeId('R'),
      main: { shipDate: localDate(), staff: '', hub: '' },
      bagshields: [],
      activeBag: newEmptyBag(),
      editingBagId: null
    };
  }

  function newEmptyBag() {
    return { id: makeId('B'), bagshieldNo: '', packages: [] };
  }

  let state = getFreshState();

  // ACCESS & API
  async function apiRequest(path, method = 'GET', body) {
    const options = {
      method,
      headers: { 'x-app-pin': accessPin }
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({ ok: false, message: 'Server mengirim respons yang tidak dapat dibaca.' }));

    if (response.status === 401) {
      accessPin = '';
      sessionStorage.removeItem('helpdesk_access_pin');
      showGate('Kode akses tidak benar atau sesi berakhir. Masukkan kembali kode akses.');
      throw new Error(data.message || 'Kode akses tidak valid.');
    }

    if (!response.ok || !data.ok) {
      throw new Error(data.message || `Permintaan gagal (${response.status}).`);
    }
    return data;
  }

  function showGate(message = '') {
    $('accessGate').classList.remove('hidden');
    $('appShell').classList.add('hidden');
    $('gateMessage').textContent = message;
    $('accessPin').value = '';
  }

  async function unlock() {
    const pin = $('accessPin').value.trim();
    if (!pin) {
      $('gateMessage').textContent = 'Kode akses wajib diisi.';
      return;
    }
    $('btnUnlock').disabled = true;
    $('btnUnlock').textContent = 'Memeriksa...';
    try {
      accessPin = pin;
      appInfo = await apiRequest('/api/health');
      sessionStorage.setItem('helpdesk_access_pin', pin);
      $('accessGate').classList.add('hidden');
      $('appShell').classList.remove('hidden');
      setConnection('online', 'Google Sheets & Drive terhubung');
      await openDraftDatabase();
      await restoreDraft();
    } catch (error) {
      accessPin = '';
      sessionStorage.removeItem('helpdesk_access_pin');
      $('gateMessage').textContent = error.message;
    } finally {
      $('btnUnlock').disabled = false;
      $('btnUnlock').textContent = 'Masuk ke Aplikasi';
    }
  }

  // LOCAL DRAFT DATABASE (INDEXEDDB)
  function openDraftDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(DB_STORE)) {
          database.createObjectStore(DB_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = event => {
        db = event.target.result;
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('Browser tidak dapat membuka penyimpanan draft.'));
    });
  }

  function persistDraft() {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      transaction.objectStore(DB_STORE).put({ id: 'active', updatedAt: new Date().toISOString(), data: state });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Draft gagal disimpan.'));
    });
  }

  function getDraft() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readonly');
      const request = transaction.objectStore(DB_STORE).get('active');
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error || new Error('Draft tidak dapat dibaca.'));
    });
  }

  function deleteDraft() {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      transaction.objectStore(DB_STORE).delete('active');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Draft tidak dapat dihapus.'));
    });
  }

  async function restoreDraft() {
    $('shipDate').value = state.main.shipDate || localDate();
    try {
      const saved = await getDraft();
      if (saved && saved.reportId) {
        state = saved;
        renderAll();
        if (state.main.shipDate && state.main.staff && state.main.hub) {
          showBagSection();
          toast('Draft sebelumnya berhasil dipulihkan dari perangkat ini.');
        } else {
          showMainSection();
        }
      } else {
        $('shipDate').value = state.main.shipDate;
      }
    } catch (error) {
      console.error(error);
      toast('Draft lokal tidak dapat dipulihkan: ' + error.message);
    }
  }

  // MAIN FORM & NAVIGATION
  function readMainForm() {
    return {
      shipDate: $('shipDate').value,
      staff: $('staff').value.trim(),
      hub: $('hub').value.trim()
    };
  }

  function fillMainForm() {
    $('shipDate').value = state.main.shipDate || localDate();
    $('staff').value = state.main.staff || '';
    $('hub').value = state.main.hub || '';
  }

  function setStep(active) {
    ['stepMain', 'stepBags', 'stepFinish'].forEach((id, index) => {
      $(id).classList.toggle('active', index === active);
    });
  }

  function showMainSection() {
    $('mainSection').classList.remove('hidden');
    $('bagSection').classList.add('hidden');
    $('successSection').classList.add('hidden');
    fillMainForm();
    setStep(0);
  }

  function showBagSection() {
    $('mainSection').classList.add('hidden');
    $('bagSection').classList.remove('hidden');
    $('successSection').classList.add('hidden');
    setStep(1);
  }

  function continueToBags() {
    const main = readMainForm();
    if (!main.shipDate || !main.staff || !main.hub) {
      toast('Tanggal, nama petugas, dan HUB Pengirim wajib diisi.');
      return;
    }
    state.main = main;
    if (!state.activeBag) state.activeBag = newEmptyBag();
    persistDraft().catch(error => toast(error.message));
    showBagSection();
    renderAll();
  }

  // PACKAGE TYPE & PHOTO
  function setPackageMode(mode) {
    packageMode = mode;
    $('typeHasResi').classList.toggle('selected', mode === 'hasResi');
    $('typeNoResi').classList.toggle('selected', mode === 'noResi');
    $('resiFields').classList.toggle('hidden', mode !== 'hasResi');
    $('noResiFields').classList.toggle('hidden', mode !== 'noResi');
    $('photoRequirement').textContent = mode === 'noResi'
      ? '(wajib untuk paket tanpa resi)'
      : '(opsional untuk paket ber-resi)';
  }

  function resetPackageForm() {
    $('awb').value = '';
    $('resiNotes').value = '';
    $('characteristics').value = '';
    $('packagePhoto').value = '';
    photoDataUrl = '';
    $('photoPreview').src = '';
    $('photoPreview').classList.add('hidden');
    $('photoInfo').textContent = 'Belum ada foto';
    setPackageMode('hasResi');
  }

  async function compressImage(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Pilih file foto/gambar yang valid.');
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Foto tidak dapat dibaca.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Foto tidak dapat dibuka.'));
      element.src = source;
    });
    const maxDimension = 1280;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.76);
    const approxBytes = Math.ceil((result.length - result.indexOf(',') - 1) * 0.75);
    if (approxBytes > 2.5 * 1024 * 1024) throw new Error('Ukuran foto masih terlalu besar. Pilih foto dengan resolusi lebih kecil.');
    return result;
  }

  async function onPhotoSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      photoDataUrl = await compressImage(file);
      $('photoPreview').src = photoDataUrl;
      $('photoPreview').classList.remove('hidden');
      $('photoInfo').textContent = `Siap diunggah · sekitar ${Math.round(photoDataUrl.length / 1024)} KB`;
    } catch (error) {
      photoDataUrl = '';
      $('packagePhoto').value = '';
      toast(error.message);
    }
  }

  function getCurrentPackageDuplicates(awb) {
    const normalized = awb.toUpperCase();
    const inCurrent = (state.activeBag.packages || []).some(p => p.hasResi && String(p.awb).trim().toUpperCase() === normalized);
    const inSaved = state.bagshields.some(b => {
      if (b.id === state.editingBagId) return false;
      return (b.packages || []).some(p => p.hasResi && String(p.awb).trim().toUpperCase() === normalized);
    });
    return inCurrent || inSaved;
  }

  async function addPackage() {
    if (!state.activeBag) state.activeBag = newEmptyBag();
    const hasResi = packageMode === 'hasResi';
    const awb = $('awb').value.trim();
    const details = hasResi ? $('resiNotes').value.trim() : $('characteristics').value.trim();

    if (hasResi && !awb) {
      toast('Nomor resi wajib diisi atau discan.');
      $('awb').focus();
      return;
    }
    if (!hasResi && details.length < 5) {
      toast('Ciri-ciri fisik paket wajib dijelaskan dengan cukup jelas.');
      $('characteristics').focus();
      return;
    }
    if (!hasResi && !photoDataUrl) {
      toast('Paket tanpa resi wajib memiliki foto bukti.');
      return;
    }
    if (hasResi && getCurrentPackageDuplicates(awb)) {
      toast(`AWB ${awb} sudah pernah dimasukkan dalam laporan ini.`);
      return;
    }

    state.activeBag.packages.push({
      id: makeId('P'),
      hasResi,
      awb: hasResi ? awb : '',
      characteristics: details,
      photoDataUrl: photoDataUrl || '',
      photoUrl: '',
      photoName: ''
    });

    resetPackageForm();
    renderAll();
    try { await persistDraft(); } catch (error) { toast(error.message); }
    toast('Paket berhasil ditambahkan ke Bagshield.');
  }

  function removePackage(packageId) {
    state.activeBag.packages = state.activeBag.packages.filter(p => p.id !== packageId);
    renderAll();
    persistDraft().catch(error => toast(error.message));
  }

  // BAGSHIELD DRAFTS
  async function saveCurrentBag() {
    const bagNo = $('bagshieldNo').value.trim();
    if (!bagNo) {
      toast('Nomor Bagshield wajib diisi atau discan.');
      $('bagshieldNo').focus();
      return;
    }
    if (!state.activeBag.packages.length) {
      toast('Tambahkan minimal satu paket ke Bagshield ini.');
      return;
    }
    const duplicate = state.bagshields.some(b =>
      b.id !== state.editingBagId && b.bagshieldNo.trim().toUpperCase() === bagNo.toUpperCase()
    );
    if (duplicate) {
      toast(`Nomor Bagshield ${bagNo} sudah ada di draft.`);
      return;
    }

    state.activeBag.bagshieldNo = bagNo;
    if (state.editingBagId) {
      const index = state.bagshields.findIndex(b => b.id === state.editingBagId);
      if (index >= 0) state.bagshields[index] = JSON.parse(JSON.stringify(state.activeBag));
      state.editingBagId = null;
      toast('Revisi Bagshield disimpan sementara.');
    } else {
      state.bagshields.push(JSON.parse(JSON.stringify(state.activeBag)));
      toast('Bagshield berhasil disimpan sementara.');
    }
    state.activeBag = newEmptyBag();
    resetPackageForm();
    renderAll();
    await persistDraft();
    $('bagshieldNo').focus();
  }

  function editBag(bagId) {
    if (state.activeBag && (state.activeBag.bagshieldNo || state.activeBag.packages.length)) {
      if (!confirm('Bagshield aktif yang belum disimpan akan diganti. Lanjutkan revisi?')) return;
    }
    const bag = state.bagshields.find(b => b.id === bagId);
    if (!bag) return;
    state.activeBag = JSON.parse(JSON.stringify(bag));
    state.editingBagId = bagId;
    resetPackageForm();
    renderAll();
    persistDraft().catch(error => toast(error.message));
    $('bagshieldNo').focus();
    toast('Mode revisi Bagshield aktif.');
  }

  function cancelBagEdit() {
    if (!state.editingBagId) return;
    state.editingBagId = null;
    state.activeBag = newEmptyBag();
    resetPackageForm();
    renderAll();
    persistDraft().catch(error => toast(error.message));
  }

  function deleteBag(bagId) {
    if (!confirm('Hapus Bagshield ini dari draft?')) return;
    state.bagshields = state.bagshields.filter(b => b.id !== bagId);
    if (state.editingBagId === bagId) {
      state.editingBagId = null;
      state.activeBag = newEmptyBag();
    }
    renderAll();
    persistDraft().catch(error => toast(error.message));
  }

  function addNewBag() {
    const activeHasData = state.activeBag && (state.activeBag.bagshieldNo || state.activeBag.packages.length);
    if (activeHasData) {
      toast('Simpan sementara Bagshield yang sedang dikerjakan terlebih dahulu.');
      return;
    }
    state.activeBag = newEmptyBag();
    state.editingBagId = null;
    resetPackageForm();
    renderAll();
    persistDraft().catch(error => toast(error.message));
    $('bagshieldNo').focus();
  }

  // RENDER UI
  function renderActiveBag() {
    const bag = state.activeBag || newEmptyBag();
    $('bagshieldNo').value = bag.bagshieldNo || '';
    $('editorTitle').textContent = state.editingBagId ? 'Revisi Bagshield' : 'Bagshield Baru';
    $('editorStatus').textContent = state.editingBagId ? 'Sedang direvisi' : 'Belum disimpan';
    $('btnCancelEdit').classList.toggle('hidden', !state.editingBagId);
    $('activePackageCount').textContent = `${bag.packages.length} paket`;

    if (!bag.packages.length) {
      $('activePackageList').className = 'package-list empty-list';
      $('activePackageList').textContent = 'Belum ada paket yang ditambahkan.';
      return;
    }

    $('activePackageList').className = 'package-list';
    $('activePackageList').innerHTML = bag.packages.map((pkg, index) => `
      <div class="package-row">
        <div class="row-main">
          <div class="row-title">${index + 1}. ${pkg.hasResi ? '📦 ' + escapeHtml(pkg.awb) : '⚠ Paket tanpa resi'}</div>
          <div class="row-detail">${pkg.hasResi ? 'Ada resi' : 'Ciri-ciri: ' + escapeHtml(pkg.characteristics)}${pkg.photoDataUrl || pkg.photoUrl ? ' · Foto tersedia' : ''}</div>
        </div>
        ${pkg.photoDataUrl ? `<img class="row-thumb" src="${pkg.photoDataUrl}" alt="Foto paket">` : ''}
        <div class="row-actions"><button type="button" class="mini-btn delete" data-remove-package="${escapeHtml(pkg.id)}">Hapus</button></div>
      </div>
    `).join('');

    $('activePackageList').querySelectorAll('[data-remove-package]').forEach(button => {
      button.addEventListener('click', () => removePackage(button.dataset.removePackage));
    });
  }

  function renderSavedBags() {
    const bagCount = state.bagshields.length;
    const packages = state.bagshields.reduce((sum, bag) => sum + bag.packages.length, 0);
    const noResi = state.bagshields.reduce((sum, bag) => sum + bag.packages.filter(p => !p.hasResi).length, 0);
    $('metricBags').textContent = bagCount;
    $('metricPackages').textContent = packages;
    $('metricNoResi').textContent = noResi;
    $('savedBagCount').textContent = `${bagCount} Bagshield`;

    if (!bagCount) {
      $('savedBagList').className = 'saved-bag-list empty-list';
      $('savedBagList').textContent = 'Belum ada Bagshield yang disimpan.';
    } else {
      $('savedBagList').className = 'saved-bag-list';
      $('savedBagList').innerHTML = state.bagshields.map((bag, index) => {
        const withResi = bag.packages.filter(p => p.hasResi).length;
        const withoutResi = bag.packages.length - withResi;
        return `
          <div class="saved-row">
            <div class="row-main">
              <div class="row-title">🛡️ ${index + 1}. ${escapeHtml(bag.bagshieldNo)}</div>
              <div class="row-detail">${bag.packages.length} paket · ${withResi} ada resi · ${withoutResi} tanpa resi</div>
              ${state.editingBagId === bag.id ? '<div class="row-detail"><b>Sedang direvisi</b></div>' : ''}
            </div>
            <div class="row-actions">
              <button type="button" class="mini-btn" data-edit-bag="${escapeHtml(bag.id)}">Revisi</button>
              <button type="button" class="mini-btn delete" data-delete-bag="${escapeHtml(bag.id)}">Hapus</button>
            </div>
          </div>
        `;
      }).join('');
      $('savedBagList').querySelectorAll('[data-edit-bag]').forEach(button => {
        button.addEventListener('click', () => editBag(button.dataset.editBag));
      });
      $('savedBagList').querySelectorAll('[data-delete-bag]').forEach(button => {
        button.addEventListener('click', () => deleteBag(button.dataset.deleteBag));
      });
    }

    const activeHasData = state.activeBag && (state.activeBag.bagshieldNo || state.activeBag.packages.length);
    $('btnFinalize').disabled = busy || !bagCount || !!state.editingBagId || !!activeHasData;
  }

  function renderAll() {
    renderActiveBag();
    renderSavedBags();
  }

  // SCANNER: CAMERA BACK + USB/BLUETOOTH SCANNER KEYBOARD INPUT
  async function openScanner(target) {
    if (typeof Html5Qrcode === 'undefined') {
      toast('Library pemindai gagal dimuat. Periksa koneksi internet lalu muat ulang.');
      return;
    }
    await closeScanner();
    scannerTarget = target;
    scannerLocked = false;
    $('scannerTitle').textContent = target === 'bag' ? 'Scan Nomor Bagshield' : 'Scan Nomor Resi / AWB';
    $('scannerModal').classList.remove('hidden');

    try {
      scanner = new Html5Qrcode('reader');
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 270, height: 150 }, aspectRatio: 1.7 },
        async decodedText => {
          if (scannerLocked) return;
          const code = String(decodedText || '').trim();
          if (!code) return;
          scannerLocked = true;
          if (scannerTarget === 'bag') {
            $('bagshieldNo').value = code;
            if (state.activeBag) state.activeBag.bagshieldNo = code;
          } else {
            $('awb').value = code;
          }
          await closeScanner();
          toast(`Barcode terbaca: ${code}`);
          (scannerTarget === 'bag' ? $('bagshieldNo') : $('awb')).focus();
        },
        () => {}
      );
    } catch (error) {
      console.error(error);
      await closeScanner();
      toast('Kamera gagal dibuka. Izinkan akses kamera pada Chrome dan gunakan link HTTPS.');
    }
  }

  async function closeScanner() {
    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop();
        scanner.clear();
      } catch (error) {
        console.warn('Scanner close:', error);
      }
      scanner = null;
    }
    $('scannerModal').classList.add('hidden');
  }

  // FINALIZE: UPLOAD FOTO -> GOOGLE SHEETS -> EXCEL
  function setProgress(percent, message) {
    $('uploadProgressWrap').classList.remove('hidden');
    $('uploadProgress').style.width = `${Math.max(0, Math.min(100, percent))}%`;
    $('progressText').textContent = message;
  }

  async function uploadPendingPhotos() {
    const pending = [];
    state.bagshields.forEach(bag => bag.packages.forEach(pkg => {
      if (pkg.photoDataUrl && !pkg.photoUrl) pending.push({ bag, pkg });
    }));

    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      setProgress(
        pending.length ? Math.round((index / pending.length) * 70) : 70,
        `Mengunggah foto ${index + 1} dari ${pending.length} ke Google Drive...`
      );
      const uploaded = await apiRequest('/api/upload-photo', 'POST', {
        reportId: state.reportId,
        packageId: item.pkg.id,
        dataUrl: item.pkg.photoDataUrl
      });
      item.pkg.photoUrl = uploaded.url;
      item.pkg.photoName = uploaded.fileName;
      await persistDraft();
    }
  }

  function validateBeforeFinalize() {
    const main = readMainForm();
    if (!main.shipDate || !main.staff || !main.hub) {
      throw new Error('Tanggal, nama petugas, dan HUB Pengirim wajib diisi.');
    }
    if (!state.bagshields.length) throw new Error('Tambahkan minimal satu Bagshield.');
    if (state.editingBagId) throw new Error('Selesaikan revisi Bagshield terlebih dahulu.');
    if (state.activeBag && (state.activeBag.bagshieldNo || state.activeBag.packages.length)) {
      throw new Error('Masih ada Bagshield aktif yang belum disimpan sementara.');
    }
    state.bagshields.forEach(bag => {
      if (!bag.packages.length) throw new Error(`Bagshield ${bag.bagshieldNo} belum memiliki paket.`);
      bag.packages.forEach(pkg => {
        if (pkg.hasResi && !pkg.awb.trim()) throw new Error(`AWB pada Bagshield ${bag.bagshieldNo} belum diisi.`);
        if (!pkg.hasResi && (!pkg.characteristics.trim() || (!pkg.photoDataUrl && !pkg.photoUrl))) {
          throw new Error(`Paket tanpa resi pada Bagshield ${bag.bagshieldNo} wajib dilengkapi ciri-ciri dan foto.`);
        }
      });
    });
    state.main = main;
  }

  async function finalizeReport() {
    if (busy) return;
    try {
      validateBeforeFinalize();
    } catch (error) {
      toast(error.message);
      return;
    }

    busy = true;
    $('btnFinalize').textContent = 'Memproses laporan...';
    renderSavedBags();
    try {
      await uploadPendingPhotos();
      setProgress(76, 'Menyimpan rekap Bagshield dan detail paket ke Google Sheets...');
      const payload = {
        reportId: state.reportId,
        main: state.main,
        bagshields: state.bagshields.map(bag => ({
          id: bag.id,
          bagshieldNo: bag.bagshieldNo,
          packages: bag.packages.map(pkg => ({
            id: pkg.id,
            hasResi: pkg.hasResi,
            awb: pkg.awb || '',
            characteristics: pkg.characteristics || '',
            photoUrl: pkg.photoUrl || '',
            photoName: pkg.photoName || ''
          }))
        }))
      };

      const result = await apiRequest('/api/save-report', 'POST', payload);
      lastSavedReport = {
        result,
        main: JSON.parse(JSON.stringify(state.main)),
        bagshields: JSON.parse(JSON.stringify(state.bagshields))
      };

      setProgress(100, 'Laporan berhasil disimpan. Menyiapkan file Excel...');
      await deleteDraft();
      showSuccess(result);
      try {
        await downloadExcel(lastSavedReport);
      } catch (excelError) {
        console.error(excelError);
        toast('Data sudah tersimpan. Unduhan Excel dapat dicoba kembali dari layar hasil.');
      }
    } catch (error) {
      console.error(error);
      toast(`Proses belum selesai: ${error.message}. Draft tetap disimpan di perangkat.`);
      $('progressText').textContent = `Gagal: ${error.message} · Draft tetap tersimpan, silakan coba lagi.`;
    } finally {
      busy = false;
      $('btnFinalize').textContent = 'Finalisasi & Download Excel →';
      renderSavedBags();
    }
  }

  function showSuccess(result) {
    $('mainSection').classList.add('hidden');
    $('bagSection').classList.add('hidden');
    $('successSection').classList.remove('hidden');
    setStep(2);
    $('successSummary').textContent = `${result.bagshieldCount} Bagshield dan ${result.packageCount} paket berhasil dicatat. Foto bukti tersimpan di Google Drive.`;
    $('summaryLink').href = result.summarySheetUrl;
    $('detailLink').href = result.detailSheetUrl;
    $('driveLink').href = result.driveFolderUrl;
    setConnection('online', 'Laporan berhasil disimpan');
  }

  async function downloadExcel(report) {
    if (!window.ExcelJS) throw new Error('Library Excel belum termuat. Periksa internet, lalu coba Download Excel Lagi.');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Helpdesk Serah Terima Paket';
    workbook.created = new Date();

    const summary = workbook.addWorksheet('Rekap Bagshield', { views: [{ state: 'frozen', ySplit: 1 }] });
    summary.columns = [
      { header: 'No', key: 'no', width: 7 },
      { header: 'Tanggal Pengiriman', key: 'date', width: 19 },
      { header: 'Nama Petugas', key: 'staff', width: 22 },
      { header: 'HUB Pengirim', key: 'hub', width: 22 },
      { header: 'No Bagshield', key: 'bag', width: 25 },
      { header: 'Total Paket', key: 'total', width: 14 },
      { header: 'Ada Resi', key: 'with', width: 13 },
      { header: 'Tanpa Resi', key: 'without', width: 13 }
    ];

    report.bagshields.forEach((bag, index) => {
      summary.addRow({
        no: index + 1,
        date: report.main.shipDate,
        staff: report.main.staff,
        hub: report.main.hub,
        bag: bag.bagshieldNo,
        total: bag.packages.length,
        with: bag.packages.filter(pkg => pkg.hasResi).length,
        without: bag.packages.filter(pkg => !pkg.hasResi).length
      });
    });

    const detail = workbook.addWorksheet('Detail Paket', { views: [{ state: 'frozen', ySplit: 1 }] });
    detail.columns = [
      { header: 'No', key: 'no', width: 7 },
      { header: 'Tanggal Pengiriman', key: 'date', width: 19 },
      { header: 'Nama Petugas', key: 'staff', width: 22 },
      { header: 'HUB Pengirim', key: 'hub', width: 22 },
      { header: 'No Bagshield', key: 'bag', width: 25 },
      { header: 'Status Resi', key: 'status', width: 16 },
      { header: 'No Resi / AWB', key: 'awb', width: 25 },
      { header: 'Ciri-ciri / Keterangan Paket', key: 'desc', width: 45 },
      { header: 'Link Foto Google Drive', key: 'photo', width: 38 }
    ];

    let rowNumber = 1;
    report.bagshields.forEach(bag => bag.packages.forEach(pkg => {
      const row = detail.addRow({
        no: rowNumber++,
        date: report.main.shipDate,
        staff: report.main.staff,
        hub: report.main.hub,
        bag: bag.bagshieldNo,
        status: pkg.hasResi ? 'ADA RESI' : 'TANPA RESI',
        awb: pkg.awb || '-',
        desc: pkg.characteristics || '-',
        photo: pkg.photoUrl || '-'
      });
      if (pkg.photoUrl) {
        row.getCell(9).value = { text: 'Buka Foto Bukti', hyperlink: pkg.photoUrl };
        row.getCell(9).font = { color: { argb: 'FF0563C8' }, underline: true };
      }
    }));

    [summary, detail].forEach(sheet => {
      sheet.getRow(1).height = 30;
      sheet.getRow(1).eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC2185B' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
      sheet.eachRow((row, index) => {
        if (index > 1) row.alignment = { vertical: 'top', wrapText: true };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeHub = String(report.main.hub || 'HUB').replace(/[^a-z0-9_-]/gi, '_').slice(0, 30);
    link.href = url;
    link.download = `Helpdesk_Serah_Terima_${report.main.shipDate}_${safeHub}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  function startNewReport() {
    if (!confirm('Mulai laporan baru? Pastikan Excel laporan sebelumnya sudah terunduh.')) return;
    state = getFreshState();
    lastSavedReport = null;
    $('uploadProgressWrap').classList.add('hidden');
    $('uploadProgress').style.width = '0%';
    $('shipDate').value = state.main.shipDate;
    $('staff').value = '';
    $('hub').value = '';
    resetPackageForm();
    renderAll();
    showMainSection();
    persistDraft().catch(error => toast(error.message));
  }

  // EVENTS
  $('btnUnlock').addEventListener('click', unlock);
  $('accessPin').addEventListener('keydown', event => { if (event.key === 'Enter') unlock(); });
  $('btnExit').addEventListener('click', () => {
    accessPin = '';
    sessionStorage.removeItem('helpdesk_access_pin');
    closeScanner();
    showGate('Sesi aplikasi telah ditutup.');
  });
  $('btnContinue').addEventListener('click', continueToBags);
  $('btnBackMain').addEventListener('click', () => {
    state.main = readMainForm();
    fillMainForm();
    showMainSection();
  });
  $('btnAddPackage').addEventListener('click', addPackage);
  $('btnSaveBag').addEventListener('click', () => saveCurrentBag().catch(error => toast(error.message)));
  $('btnCancelEdit').addEventListener('click', cancelBagEdit);
  $('btnNewBag').addEventListener('click', addNewBag);
  $('btnFinalize').addEventListener('click', finalizeReport);
  $('typeHasResi').addEventListener('click', () => setPackageMode('hasResi'));
  $('typeNoResi').addEventListener('click', () => setPackageMode('noResi'));
  $('packagePhoto').addEventListener('change', onPhotoSelected);
  $('btnScanBag').addEventListener('click', () => openScanner('bag'));
  $('btnScanAwb').addEventListener('click', () => openScanner('awb'));
  $('btnCloseScanner').addEventListener('click', closeScanner);
  $('scannerModal').addEventListener('click', event => { if (event.target === $('scannerModal')) closeScanner(); });
  $('awb').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addPackage(); } });
  $('bagshieldNo').addEventListener('input', () => { if (state.activeBag) state.activeBag.bagshieldNo = $('bagshieldNo').value; });
  $('btnDownloadAgain').addEventListener('click', async () => {
    if (!lastSavedReport) return toast('Data laporan tidak tersedia di sesi ini.');
    try { await downloadExcel(lastSavedReport); } catch (error) { toast(error.message); }
  });
  $('btnNewReport').addEventListener('click', startNewReport);

  window.addEventListener('beforeunload', () => {
    if (db && !lastSavedReport) persistDraft();
  });

  // Resume active session if this tab still has a valid team code.
  async function boot() {
    $('shipDate').value = state.main.shipDate;
    accessPin = sessionStorage.getItem('helpdesk_access_pin') || '';
    if (accessPin) {
      try {
        appInfo = await apiRequest('/api/health');
        $('accessGate').classList.add('hidden');
        $('appShell').classList.remove('hidden');
        setConnection('online', 'Google Sheets & Drive terhubung');
        await openDraftDatabase();
        await restoreDraft();
        return;
      } catch (error) {
        accessPin = '';
        sessionStorage.removeItem('helpdesk_access_pin');
        showGate(error.message);
      }
    }
    showGate();
  }

  boot();
})();
