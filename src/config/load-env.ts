// This is the single canonical location for environment loading. Do NOT add
// dotenv.config() to route modules or any other module — import this file as a
// side-effect instead (see src/server.ts). Redundant dotenv.config() calls are
// CWD-dependent and conflict with the load order established here.
import dotenv from 'dotenv';

dotenv.config({ path: '.env', override: false });
dotenv.config({ path: '.env.local', override: true });
