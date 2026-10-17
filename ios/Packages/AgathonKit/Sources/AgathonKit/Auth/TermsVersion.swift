/// What sign-up asks a new account to agree to: the Terms, the Privacy Policy, and "I'm 13 or
/// older, or I'm a parent or guardian setting this up for my child".
public enum TermsVersion {
    /// KEEP IN STEP with `TERMS_VERSION` in src/lib/legal.ts (a unit test reads that file and
    /// compares). Sign-up sends it as `options.data.terms_version`; the database's
    /// `require_signup_terms` trigger refuses a sign-up without one, and one dated in the future
    /// (supabase/migrations/20261003010000_signup_consent.sql). When the web's text changes, change
    /// this with it, and ship the app before (or with) the web's change goes live.
    public static let current = "2026-10-11"
}
