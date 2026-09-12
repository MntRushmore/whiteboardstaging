import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const MISSING_ENV_MESSAGE =
  "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
  "(see .env.example). Auth and board persistence cannot work without them.";

if (!supabaseUrl || !supabaseAnonKey) {
  if (typeof window !== "undefined") {
    // In the browser this is unrecoverable: fail loudly at module load rather
    // than silently talking to a placeholder host.
    throw new Error(MISSING_ENV_MESSAGE);
  }
  // On the server (SSR / build prerender of client components) we only warn so
  // `next build` can still complete in environments without the public vars.
  console.warn(MISSING_ENV_MESSAGE);
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-key",
);
