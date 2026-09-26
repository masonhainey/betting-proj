// Supabase project for accounts + sync. Both values come from
// Supabase → Project Settings → API. The anon key is designed to be public (every
// request is still limited to the signed-in user by row-level security), so it's fine
// to commit. Never put the service_role key here.
//
// Leave these empty and hedgehog runs exactly as before: local-only, no sign-in.
export const SUPABASE_URL = "https://vcmgdhmhizyqjnyjxmcl.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_uKY0eEvFEDrBlD_jpOzEPA_MAb1PSLw";
