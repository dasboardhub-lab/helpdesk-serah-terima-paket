const {
  checkAccess,
  initializeWorkspace,
  apiError
} = require('../lib/google');

function validate(payload) {
  if (!payload || !payload.reportId || !payload.main || !Array.isArray(payload.bagshields)) {
    throw new Error('Struktur laporan tidak lengkap.');
  }
  const m = payload.main;
  if (!m.shipDate || !String(m.staff || '').trim() || !String(m.hub || '').trim()) {
    throw new Error('Tanggal, nama petugas, dan HUB Pengirim wajib diisi.');
  }
  if (!payload.bagshields.length) throw new Error('Tambahkan minimal satu Bagshield.');

  const bagNumbers = new Set();
  const awbs = new Set();
  payload.bagshields.forEach((bag, index) => {
    const bagNo = String(bag.bagshieldNo || '').trim();
    if (!bag.id || !bagNo) throw new Error(`Nomor Bagshield ke-${index + 1} belum lengkap.`);
    const normalizedBag = bagNo.toUpperCase();
    if (bagNumbers.has(normalizedBag)) throw new Error(`Nomor Bagshield ${bagNo} terduplikasi dalam laporan.`);
    bagNumbers.add(normalizedBag);
    if (!Array.isArray(bag.packages) || !bag.packages.length) throw new Error(`Bagshield ${bagNo} belum memiliki paket.`);
    bag.packages.forEach((p, pIndex) => {
      if (p.hasResi) {
        const awb = String(p.awb || '').trim();
        if (!awb) throw new Error(`AWB paket ke-${pIndex + 1} pada Bagshield ${bagNo} belum diisi.`);
        const normalizedAwb = awb.toUpperCase();
        if (awbs.has(normalizedAwb)) throw new Error(`AWB ${awb} tercatat lebih dari satu kali dalam laporan.`);
        awbs.add(normalizedAwb);
      } else if (!String(p.characteristics || '').trim() || !String(p.photoUrl || '').trim()) {
        throw new Error(`Paket tanpa resi pada Bagshield ${bagNo} wajib memiliki ciri-ciri dan foto Drive.`);
      }
    });
  });
}

function cell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: value == null ? '' : String(value) } };
}

async function getExistingReportRows(sheets, spreadsheetId, title, reportId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${title.replace(/'/g, "''")}'!A2:A`
  });
  const values = response.data.values || [];
  const indexes = [];
  values.forEach((row, index) => {
    if (String(row[0] || '') === String(reportId)) indexes.push(index + 1); // zero-based row index; row 2 => 1
  });
  return indexes.sort((a, b) => b - a);
}

function deleteRequests(sheetId, indexes) {
  return indexes.map(index => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: index,
        endIndex: index + 1
      }
    }
  }));
}

function appendRequest(sheetId, rows) {
  if (!rows.length) return null;
  return {
    appendCells: {
      sheetId,
      rows: rows.map(row => ({ values: row.map(cell) })),
      fields: 'userEnteredValue'
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method tidak didukung.' });
  try {
    checkAccess(req);
    const payload = req.body || {};
    validate(payload);

    const info = await initializeWorkspace();
    const { sheets, spreadsheetId, summary, detail } = info;
    const reportId = String(payload.reportId);
    const main = payload.main;
    const now = new Date().toISOString();

    const summaryRows = [];
    const detailRows = [];

    payload.bagshields.forEach(bag => {
      const packages = bag.packages || [];
      const withResi = packages.filter(p => p.hasResi).length;
      summaryRows.push([
        reportId,
        String(bag.id),
        String(main.shipDate),
        String(main.staff).trim(),
        String(main.hub).trim(),
        String(bag.bagshieldNo).trim(),
        packages.length,
        withResi,
        packages.length - withResi,
        now
      ]);

      packages.forEach(p => {
        detailRows.push([
          reportId,
          String(bag.id),
          String(main.shipDate),
          String(main.staff).trim(),
          String(main.hub).trim(),
          String(bag.bagshieldNo).trim(),
          p.hasResi ? 'ADA RESI' : 'TANPA RESI',
          p.hasResi ? String(p.awb).trim() : '',
          String(p.characteristics || '').trim(),
          String(p.photoUrl || ''),
          String(p.photoName || ''),
          now
        ]);
      });
    });

    // Report ID makes retry/revision idempotent: old rows for this report are removed
    // and replaced in one Sheets batchUpdate request.
    const [oldSummaryRows, oldDetailRows] = await Promise.all([
      getExistingReportRows(sheets, spreadsheetId, summary.title, reportId),
      getExistingReportRows(sheets, spreadsheetId, detail.title, reportId)
    ]);

    const requests = [
      ...deleteRequests(summary.sheetId, oldSummaryRows),
      ...deleteRequests(detail.sheetId, oldDetailRows)
    ];
    const appendSummary = appendRequest(summary.sheetId, summaryRows);
    const appendDetail = appendRequest(detail.sheetId, detailRows);
    if (appendSummary) requests.push(appendSummary);
    if (appendDetail) requests.push(appendDetail);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });

    return res.status(200).json({
      ok: true,
      reportId,
      bagshieldCount: summaryRows.length,
      packageCount: detailRows.length,
      savedAt: now,
      spreadsheetUrl: info.spreadsheetUrl,
      summarySheetUrl: `${info.spreadsheetUrl}#gid=${summary.sheetId}`,
      detailSheetUrl: `${info.spreadsheetUrl}#gid=${detail.sheetId}`,
      driveFolderUrl: info.folder.webViewLink || `https://drive.google.com/drive/folders/${info.folder.id}`
    });
  } catch (error) {
    return apiError(res, error);
  }
};
