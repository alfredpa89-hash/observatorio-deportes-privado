export function cloudConfig(env = process.env) {
  const required = name => { const value = env[name]?.trim(); if (!value) throw new Error(`Falta configurar ${name}.`); return value; };
  const origin = new URL(required('OBSERVATORIO_PUBLIC_URL'));
  const supabase = new URL(required('SUPABASE_URL'));
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('La direccion publica debe ser un origen HTTPS.');
  if (supabase.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(supabase.hostname) || supabase.port || supabase.username || supabase.password || supabase.pathname !== '/' || supabase.search || supabase.hash) throw new Error('URL de proyecto Supabase no valida.');
  const owner = required('OBSERVATORIO_OWNER_ID');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(owner)) throw new Error('El propietario debe ser el UUID de un usuario de Auth.');
  const encryptionKey = required('OBSERVATORIO_STORAGE_SECRET');
  if (encryptionKey.length < 32) throw new Error('El secreto de almacenamiento debe tener al menos 32 caracteres.');
  return { origin: origin.origin, supabaseUrl: supabase.origin, owner,
    publishableKey: required('SUPABASE_PUBLISHABLE_KEY'), serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'), encryptionKey,
    bucket: 'observatorio-private', port: Number(env.PORT || 10000) };
}
