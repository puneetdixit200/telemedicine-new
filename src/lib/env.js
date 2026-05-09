const REQUIRED_PUBLIC_SUPABASE_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const REQUIRED_SERVER_SUPABASE_ENV = [...REQUIRED_PUBLIC_SUPABASE_ENV, 'SUPABASE_SERVICE_ROLE_KEY'];
const REQUIRED_AZURE_ENV = ['AZURE_STORAGE_CONNECTION_STRING', 'AZURE_STORAGE_CONTAINER'];

export function getOptionalEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

export function getRequiredServerEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function listMissingEnv(names) {
  return names.filter((name) => !process.env[name]);
}

export function getPublicSupabaseEnv() {
  const missing = listMissingEnv(REQUIRED_PUBLIC_SUPABASE_ENV);
  if (missing.length) {
    throw new Error(`Missing Supabase public environment variables: ${missing.join(', ')}`);
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  };
}

export function getServerSupabaseEnv() {
  const missing = listMissingEnv(REQUIRED_SERVER_SUPABASE_ENV);
  if (missing.length) {
    throw new Error(`Missing Supabase server environment variables: ${missing.join(', ')}`);
  }

  return {
    ...getPublicSupabaseEnv(),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

export function getAzureEnv() {
  const missing = listMissingEnv(REQUIRED_AZURE_ENV);
  if (missing.length) {
    throw new Error(`Missing Azure Blob Storage environment variables: ${missing.join(', ')}`);
  }

  return {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    containerName: process.env.AZURE_STORAGE_CONTAINER,
    publicBaseUrl: process.env.AZURE_STORAGE_PUBLIC_BASE_URL || ''
  };
}

export const envGroups = {
  publicSupabase: REQUIRED_PUBLIC_SUPABASE_ENV,
  serverSupabase: REQUIRED_SERVER_SUPABASE_ENV,
  azure: REQUIRED_AZURE_ENV
};
