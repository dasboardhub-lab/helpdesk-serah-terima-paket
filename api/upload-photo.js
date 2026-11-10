const { checkAccess, getGoogleClients, getDriveFolder, apiError } = require('../lib/google');

function safePart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50) || 'ITEM';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method tidak didukung.' });
  try {
    checkAccess(req);
    const { reportId, packageId, dataUrl } = req.body || {};
    if (!reportId || !packageId || !dataUrl) throw new Error('Data foto belum lengkap.');

    const match = String(dataUrl).match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([\s\S]+)$/i);
    if (!match) throw new Error('Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP.');

    const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) throw new Error('File foto kosong.');
    if (buffer.length > 3 * 1024 * 1024) throw new Error('Foto terlalu besar. Kompres foto sebelum diunggah (maksimal 3 MB).');

    const { drive } = await getGoogleClients();
    const folder = await getDriveFolder(drive);
    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `HD_${safePart(reportId)}_${safePart(packageId)}.${ext}`;
    const escapedName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    const existing = await drive.files.list({
      q: `name='${escapedName}' and '${folder.id}' in parents and trashed=false`,
      pageSize: 5,
      fields: 'files(id,name,webViewLink)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });

    let file;
    if (existing.data.files && existing.data.files.length) {
      const fileId = existing.data.files[0].id;
      const updated = await drive.files.update({
        fileId,
        media: { mimeType, body: buffer },
        fields: 'id,name,webViewLink',
        supportsAllDrives: true
      });
      file = updated.data;
    } else {
      const created = await drive.files.create({
        requestBody: { name: fileName, mimeType, parents: [folder.id] },
        media: { mimeType, body: buffer },
        fields: 'id,name,webViewLink',
        supportsAllDrives: true
      });
      file = created.data;
    }

    return res.status(200).json({
      ok: true,
      fileId: file.id,
      fileName: file.name,
      url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
    });
  } catch (error) {
    return apiError(res, error);
  }
};
