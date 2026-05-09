import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { uploadDocumentBlob } from '@/lib/azure/blob-storage';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function sanitizeFileName(value) {
  return String(value || 'upload.bin')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export async function POST(request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('file');

  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'A file field is required.', code: 'FILE_REQUIRED' }, { status: 400 });
  }

  const originalName = sanitizeFileName(file.name);
  const contentType = file.type || 'application/octet-stream';
  const buffer = Buffer.from(await file.arrayBuffer());
  const blobName = `${user.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${originalName}`;
  const uploaded = await uploadDocumentBlob({ blobName, buffer, contentType });

  return NextResponse.json({
    ok: true,
    document: {
      fileName: originalName,
      contentType,
      sizeBytes: buffer.length,
      blobName: uploaded.blobName,
      url: uploaded.url
    }
  });
}
