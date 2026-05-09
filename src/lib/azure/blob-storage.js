import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from '@azure/storage-blob';
import { getAzureEnv } from '@/lib/env';

let containerClient;

function parseAccountFromConnectionString(connectionString) {
  const parts = connectionString.split(';').filter(Boolean);
  const values = {};
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    values[key] = rest.join('=');
  }

  return {
    accountName: values.AccountName,
    accountKey: values.AccountKey
  };
}

export async function getAzureContainerClient() {
  if (!containerClient) {
    const { connectionString, containerName } = getAzureEnv();
    const service = BlobServiceClient.fromConnectionString(connectionString);
    containerClient = service.getContainerClient(containerName);
    await containerClient.createIfNotExists();
  }

  return containerClient;
}

export async function uploadDocumentBlob({ blobName, buffer, contentType }) {
  const container = await getAzureContainerClient();
  const blob = container.getBlockBlobClient(blobName);
  await blob.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType || 'application/octet-stream'
    }
  });

  return {
    blobName,
    url: blob.url
  };
}

export function getReadSasUrl({ blobName, expiresInMinutes = 10, contentType, contentDisposition }) {
  const { connectionString, containerName } = getAzureEnv();
  const { accountName, accountKey } = parseAccountFromConnectionString(connectionString);

  if (!accountName || !accountKey) {
    throw new Error('Azure storage connection string is missing AccountName or AccountKey.');
  }

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      expiresOn,
      permissions: BlobSASPermissions.parse('r'),
      contentType: contentType || undefined,
      contentDisposition: contentDisposition || undefined
    },
    credential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURI(blobName)}?${sas}`;
}
