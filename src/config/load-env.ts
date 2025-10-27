import dotenv from 'dotenv';

dotenv.config({ path: '.env', override: false });
dotenv.config({ path: '.env.local', override: true });
