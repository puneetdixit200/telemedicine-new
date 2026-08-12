const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

function detectDocumentMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  return null;
}

function validateDocumentUpload(req, res, next) {
  if (!req.file) return next();

  const detectedMime = detectDocumentMime(req.file.buffer);
  const claimedMime = String(req.file.mimetype || '').toLowerCase();

  if (!detectedMime || !ALLOWED_DOCUMENT_MIME_TYPES.has(detectedMime)) {
    return res.status(415).json({
      error: 'Unsupported document type. Upload a PDF, PNG, or JPEG file.'
    });
  }

  if (claimedMime && claimedMime !== detectedMime && !(claimedMime === 'image/jpg' && detectedMime === 'image/jpeg')) {
    return res.status(415).json({
      error: 'File content does not match its declared document type.'
    });
  }

  req.file.mimetype = detectedMime;
  return next();
}

module.exports = {
  ALLOWED_DOCUMENT_MIME_TYPES,
  detectDocumentMime,
  validateDocumentUpload
};
