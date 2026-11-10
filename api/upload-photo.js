
'use strict';

const {
  checkAccess,
  callBridge,
  apiError
} = require('../lib/google');

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

    // 1. Validasi kode akses petugas
    checkAccess(req);

    // 2. Ambil data foto
    const payload = req.body || {};

    const reportId = String(
      payload.reportId || ''
    ).trim();

    const packageId = String(
      payload.packageId || ''
    ).trim();

    const dataUrl = String(
      payload.dataUrl || ''
    );

    // 3. Validasi kelengkapan
    if (!reportId || !packageId || !dataUrl) {

      throw new Error(
        'Data foto belum lengkap. Periksa ID laporan, ID paket, dan foto.'
      );

    }

    // 4. Validasi format foto
    const match = dataUrl.match(
      /^data:(image\/(?:jpeg|jpg|png|webp));base64,([\s\S]+)$/i
    );

    if (!match) {

      throw new Error(
        'Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP.'
      );

    }

    // 5. Validasi ukuran foto
    const buffer = Buffer.from(
      match[2],
      'base64'
    );

    if (!buffer.length) {

      throw new Error(
        'File foto kosong atau tidak terbaca.'
      );

    }

    if (buffer.length > 3 * 1024 * 1024) {

      throw new Error(
        'Ukuran foto melebihi 3 MB. Silakan kompres foto terlebih dahulu.'
      );

    }

    // 6. Kirim foto ke Google Apps Script Bridge
    const result = await callBridge(
      'uploadPhoto',
      {
        reportId: reportId,
        packageId: packageId,
        dataUrl: dataUrl
      }
    );

    // 7. Pastikan upload berhasil
    if (!result || result.ok !== true) {

      throw new Error(
        result && result.message
          ? result.message
          : 'Google Drive gagal menerima foto.'
      );

    }

    // 8. Kembalikan informasi foto ke frontend
    return res.status(200).json({

      ok: true,

      fileId: result.fileId,

      fileName: result.fileName,

      url: result.url,

      message: 'Foto berhasil disimpan ke Google Drive.'

    });

  } catch (error) {

    console.error(
      'UPLOAD PHOTO ERROR:',
      error
    );

    return apiError(res, error);

  }

};
