// Fill these in after you create your Supabase project (see backend/SETUP.md).
// The anon key is safe to expose publicly — real security is in the Edge Functions + RLS.
export const CONFIG = {
  // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_URL: "https://fgpicmoskynozkjjscnr.supabase.co",
  // your project's public publishable key (safe in the browser)
  SUPABASE_ANON_KEY: "sb_publishable_8wLx3EBqxaPTfOc7Q8ds5A_imquCH3a",
};

export const FN = {
  prepare: () => `${CONFIG.SUPABASE_URL}/functions/v1/prepare-flash`,
  report:  () => `${CONFIG.SUPABASE_URL}/functions/v1/report-flash`,
};

export const backendReady = () => !!CONFIG.SUPABASE_URL && !!CONFIG.SUPABASE_ANON_KEY;
