/* VYRA cloud sync settings.
   Leave both empty to run fully offline (sign-in is then hidden).
   Values come from Supabase → Project Settings → API. The anon key is meant
   to be public: row-level security in supabase/schema.sql protects the data.
   Setup steps: docs/CLOUD_SYNC.md */
window.VYRA_CONFIG = {
  supabaseUrl: "https://vvsmpaqlcktfogcvgobj.supabase.co",
  supabaseAnonKey: "sb_publishable_PppXhbFRJYvIM_HWAq6lOg_6pSXkfYA",
};
