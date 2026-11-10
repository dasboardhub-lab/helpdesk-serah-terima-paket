
'use strict';

const {
  checkAccess,
  callBridge,
  apiError
} = require('../lib/google');

// =====================================================
// VALIDASI DATA LAPORAN
// =====================================================

function validateReport(payload) {

  if (
    !payload ||
    !payload.reportId ||
    !payload.main ||
    !Array.isArray(payload.bagshields)
  ) {
    const error = new Error(
      'Struktur laporan tidak lengkap.'
    );

    error.statusCode = 400;
    throw error;
  }

  const main = payload.main;

  if (
    !main.shipDate ||
    !String(main.staff || '').trim() ||
    !String(main.hub || '').trim()
  ) {
    const error = new Error(
      'Tanggal, nama petugas, dan HUB Pengirim wajib diisi.'
    );

    error.statusCode = 400;
    throw error;
  }

  if (payload.bagshields.length === 0) {
    const error = new Error(
      'Tambahkan minimal satu Bagshield.'
    );

    error.statusCode = 400;
    throw error;
  }

  const bagNumbers = new Set();
  const awbs = new Set();

  payload.bagshields.forEach((bag, index) => {

    const bagNo = String(
      bag.bagshieldNo || ''
    ).trim();

    if (!bag.id || !bagNo) {
      const error = new Error(
        `Nomor Bagshield ke-${index + 1} belum lengkap.`
      );

      error.statusCode = 400;
      throw error;
    }

    // Cek nomor Bagshield ganda
    const normalizedBag = bagNo.toUpperCase();

    if (bagNumbers.has(normalizedBag)) {
      const error = new Error(
        `Nomor Bagshield ${bagNo} tercatat lebih dari satu kali.`
      );

      error.statusCode = 400;
      throw error;
    }

    bagNumbers.add(normalizedBag);

    if (
      !Array.isArray(bag.packages) ||
      bag.packages.length === 0
    ) {
      const error = new Error(
        `Bagshield ${bagNo} belum memiliki paket.`
      );

      error.statusCode = 400;
      throw error;
    }

    bag.packages.forEach((pkg, packageIndex) => {

      if (!pkg.id) {
        const error = new Error(
          `ID paket ke-${packageIndex + 1} tidak ditemukan.`
        );

        error.statusCode = 400;
        throw error;
      }

      if (pkg.hasResi) {

        const awb = String(
          pkg.awb || ''
        ).trim();

        if (!awb) {
          const error = new Error(
            `Nomor AWB pada Bagshield ${bagNo} belum diisi.`
          );

          error.statusCode = 400;
          throw error;
        }

        // Cek AWB ganda
        const normalizedAwb = awb.toUpperCase();

        if (awbs.has(normalizedAwb)) {
          const error = new Error(
            `Nomor AWB ${awb} tercatat lebih dari satu kali.`
          );

          error.statusCode = 400;
          throw error;
        }

        awbs.add(normalizedAwb);

      } else {

        // Paket tanpa resi wajib foto dan ciri-ciri
        if (
          !String(pkg.characteristics || '').trim() ||
          !String(pkg.photoUrl || '').trim()
        ) {
          const error = new Error(
            `Paket tanpa resi pada Bagshield ${bagNo} wajib memiliki foto dan ciri-ciri paket.`
          );

          error.statusCode = 400;
          throw error;
        }

      }

    });

  });

}


// =====================================================
// API SAVE REPORT
// =====================================================

module.exports = async function handler(req, res) {

  // Hanya menerima POST
  if (req.method !== 'POST') {

    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      ok: false,
      message: 'Method tidak didukung.'
    });

  }

  try {

    // 1. Periksa kode akses petugas
    checkAccess(req);

    // 2. Ambil payload dari frontend
    const payload = req.body || {};

    // 3. Validasi seluruh laporan
    validateReport(payload);

    // 4. Kirim laporan ke Google Apps Script
    const result = await callBridge(
      'saveReport',
      payload
    );

    // 5. Periksa hasil penyimpanan Google Sheets
    if (!result || result.ok !== true) {

      throw new Error(
        result && result.message
          ? result.message
          : 'Gagal menyimpan laporan ke Google Sheets.'
      );

    }

    // 6. Berikan konfirmasi ke frontend
    return res.status(200).json({

      ok: true,

      message:
        'Laporan berhasil disimpan ke Google Sheets.',

      reportId:
        result.reportId,

      bagshieldCount:
        result.bagshieldCount,

      packageCount:
        result.packageCount,

      savedAt:
        result.savedAt,

      spreadsheetUrl:
        result.spreadsheetUrl,

      summarySheetUrl:
        result.summarySheetUrl,

      detailSheetUrl:
        result.detailSheetUrl,

      driveFolderUrl:
        result.driveFolderUrl

    });

  } catch (error) {

    console.error(
      'SAVE REPORT ERROR:',
      error
    );

    return apiError(res, error);

  }

};
