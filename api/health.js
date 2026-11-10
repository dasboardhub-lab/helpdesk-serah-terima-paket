const { checkAccess, initializeWorkspace, apiError } = require('../lib/google');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method tidak didukung.' });
  try {
    checkAccess(req);
    const info = await initializeWorkspace();
    return res.status(200).json({
      ok: true,
      app: 'Helpdesk Serah Terima Paket',
      spreadsheetName: info.spreadsheetName,
      spreadsheetUrl: info.spreadsheetUrl,
      summarySheetUrl: `${info.spreadsheetUrl}#gid=${info.summary.sheetId}`,
      detailSheetUrl: `${info.spreadsheetUrl}#gid=${info.detail.sheetId}`,
      driveFolderName: info.folder.name,
      driveFolderUrl: info.folder.webViewLink || `https://drive.google.com/drive/folders/${info.folder.id}`,
      serviceAccountEmail: info.serviceAccountEmail
    });
  } catch (error) {
    return apiError(res, error);
  }
};
