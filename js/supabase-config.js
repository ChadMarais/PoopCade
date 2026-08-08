import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm";

export const SUPABASE_URL = "https://kpssybcwwmtcdhrmfcgc.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MH-7FEYJNJ-jg3-vI0H-hQ_cEDY3-78";

// This is the only Supabase browser client instance in the application.
// supabase-js owns persistence and refresh-token storage; Poopcade never
// copies OAuth/session tokens into custom storage.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
