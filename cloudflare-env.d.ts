declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    GOOGLE_CALENDAR_CLIENT_ID?: string;
    GOOGLE_CALENDAR_CLIENT_SECRET?: string;
    GOOGLE_CALENDAR_TOKEN_KEY?: string;
    OBLAKA_OWNER_EMAIL?: string;
    /** Cloudflare Access team domain, e.g. myteam.cloudflareaccess.com */
    ACCESS_TEAM_DOMAIN?: string;
    /** Cloudflare Access application audience (AUD) tag */
    ACCESS_AUD?: string;
    OBLAKA_LOGIN_EMAIL_ALIASES?: string;
    TODOIST_IMPORT_TOKEN?: string;
    TODOIST_IMPORT_USER_ID?: string;
    TODOIST_IMPORT_ID?: string;
    BUCKET?: R2Bucket;
  }
}
