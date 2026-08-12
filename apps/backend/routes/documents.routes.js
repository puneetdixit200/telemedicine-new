const express = require('express');
const multer = require('multer');
const { authRequired } = require('../middleware/auth');
const { validateDocumentUpload } = require('../middleware/document-upload');
const { documentsController } = require('../controllers/documents.controller');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 12,
    parts: 13,
    fieldNameSize: 80,
    fieldNestingDepth: 2
  }
});
const localDownloadsEnabled = process.env.NODE_ENV !== 'production' || process.env.AZURE_UPLOADS_MODE === 'local-only';

router.post('/upload', authRequired, upload.single('file'), validateDocumentUpload, documentsController.upload);
if (localDownloadsEnabled) {
  router.get('/local/:blobName(*)', authRequired, documentsController.downloadLocal);
}
router.get('/:documentId/preview', authRequired, documentsController.previewPdf);
router.get('/:documentId/download', authRequired, documentsController.downloadLink);

module.exports = router;
