const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions
} = require('@azure/storage-blob');
const fs = require('fs');
const path = require('path');

function getContainerName() {
  return process.env.AZURE_STORAGE_CONTAINER || 'patient-documents';
}

function getUploadsMode() {
  return String(process.env.AZURE_UPLOADS_MODE || 'azure-only').toLowerCase();
}

function allowLocalReadFallback() {
  const mode = getUploadsMode();
  const isProd = process.env.NODE_ENV === 'production';

  if (mode === 'local-only') {
    return true;
  }

  return !isProd;
}

function requireConnString() {
  const cs = getAzureConnectionString();
  if (!cs) {
    const err = new Error(
      'Azure storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME/AZURE_STORAGE_ACCOUNT_KEY.'
    );
    err.status = 500;
    throw err;
  }
  return cs;
}

function isPlaceholderSecret(value) {
  return /rotate_me|replace-|your-|changeme/i.test(String(value || ''));
}

function buildConnectionStringFromAccountKey() {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.AZURE_STORAGE_ACCOUNT || '';
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY || process.env.AZURE_STORAGE_KEY || '';
  if (!accountName || !accountKey || isPlaceholderSecret(accountName) || isPlaceholderSecret(accountKey)) return '';
  const endpointSuffix = process.env.AZURE_STORAGE_ENDPOINT_SUFFIX || 'core.windows.net';
  return [
    'DefaultEndpointsProtocol=https',
    `AccountName=${accountName}`,
    `AccountKey=${accountKey}`,
    `EndpointSuffix=${endpointSuffix}`
  ].join(';');
}

function getAzureConnectionString() {
  const configured = String(process.env.AZURE_STORAGE_CONNECTION_STRING || '').trim();
  if (configured && !isPlaceholderSecret(configured)) return configured;
  return buildConnectionStringFromAccountKey();
}

function hasUsableAzureConnectionString() {
  const cs = getAzureConnectionString();
  if (!cs.trim()) return false;
  try {
    const parsed = parseAccountFromConnectionString(cs);
    if (!parsed.accountName || !parsed.accountKey) return false;
    BlobServiceClient.fromConnectionString(cs);
    return true;
  } catch (_) {
    return false;
  }
}

function isAzureConfigured() {
  return hasUsableAzureConnectionString();
}

function localUploadsRoot() {
  return path.join(process.cwd(), 'uploads');
}

function getLocalFilePath(blobName) {
  return path.join(localUploadsRoot(), blobName);
}

async function uploadBufferLocal({ blobName, buffer }) {
  const root = localUploadsRoot();
  const filePath = getLocalFilePath(blobName);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, buffer);
  return { blobName };
}

function parseAccountFromConnectionString(connectionString) {
  const parts = connectionString.split(';').filter(Boolean);
  const map = {};
  for (const part of parts) {
    const [k, ...rest] = part.split('=');
    map[k] = rest.join('=');
  }
  return {
    accountName: map.AccountName,
    accountKey: map.AccountKey
  };
}

async function getContainerClient() {
  const service = BlobServiceClient.fromConnectionString(requireConnString());
  const container = service.getContainerClient(getContainerName());
  await container.createIfNotExists();
  return container;
}

async function assertAzureReady() {
  if (!hasUsableAzureConnectionString()) {
    const err = new Error('Azure storage is not configured or connection string is invalid.');
    err.status = 500;
    throw err;
  }
  await getContainerClient();
}

async function uploadBuffer({ blobName, buffer, contentType }) {
  const mode = getUploadsMode();
  const azureReady = hasUsableAzureConnectionString();

  if (mode !== 'local-only' && !azureReady) {
    const err = new Error(
      'Azure upload is not configured. Add a real AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME/AZURE_STORAGE_ACCOUNT_KEY, or set AZURE_UPLOADS_MODE=local-only for local testing.'
    );
    err.status = 500;
    throw err;
  }

  if (mode === 'local-only') {
    return uploadBufferLocal({ blobName, buffer });
  }

  const container = await getContainerClient();
  const client = container.getBlockBlobClient(blobName);
  await client.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType
    }
  });
  return { blobName };
}

function getReadSasUrl({ blobName, expiresInMinutes = 10, contentDisposition, contentType }) {
  if (!hasUsableAzureConnectionString()) {
    if (allowLocalReadFallback()) {
      return `/documents/local/${encodeURIComponent(blobName)}`;
    }

    const err = new Error(
      'Azure storage is not configured for secure reads in production. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME/AZURE_STORAGE_ACCOUNT_KEY.'
    );
    err.status = 500;
    throw err;
  }

  const connectionString = requireConnString();
  const { accountName, accountKey } = parseAccountFromConnectionString(connectionString);
  if (!accountName || !accountKey) {
    const err = new Error('Azure storage connection string is missing AccountName/AccountKey.');
    err.status = 500;
    throw err;
  }

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const containerName = getContainerName();
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      expiresOn,
      permissions: BlobSASPermissions.parse('r'),
      contentDisposition: contentDisposition || undefined,
      contentType: contentType || undefined
    },
    credential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURI(blobName)}?${sas}`;
}

module.exports = {
  uploadBuffer,
  getReadSasUrl,
  getLocalFilePath,
  localUploadsRoot,
  getUploadsMode,
  isAzureConfigured,
  assertAzureReady,
  getAzureConnectionString
};
