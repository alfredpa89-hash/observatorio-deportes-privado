import fs from 'node:fs/promises';
import { createCloudStorage } from './storage.mjs';

// Configuracion confidencial por stdin, nunca por argumentos ni archivos .env.
console.log('Configuracion privada por stdin. No se imprimiran claves ni historial.');
const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const config = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl || '') || !config.serviceKey || !config.input) throw new Error('Configuracion privada incompleta.');
const remote = createCloudStorage({ ...config, bucket: 'observatorio-private' });
if (await remote.load() !== null) throw new Error('El alojamiento ya contiene historial. No se sobrescribira.');
const raw = await fs.readFile(config.input, 'utf8'), state = JSON.parse(raw);
if (state?.version !== 1 || !state.leagues || !Array.isArray(state.matches)) throw new Error('Historial de origen no valido.');
await remote.save(raw);
console.log('Historial cifrado y confirmado en el almacenamiento privado. La copia local no se modifico.');
