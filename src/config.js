// Public Supabase settings. These values are safe to ship to the browser:
// the publishable key only allows what the database's Row Level Security permits.
// They can be overridden at build time with SUPABASE_URL / SUPABASE_ANON_KEY.
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kiccllcmszoedglecbnh.supabase.co';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_exP6dwZXIboKtTj_mUAMIQ_rbfL5TlP';
