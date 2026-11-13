declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    OBLAKA_OWNER_EMAIL?: string;
    OBLAKA_LOGIN_EMAIL_ALIASES?: string;
    TODOIST_IMPORT_TOKEN?: string;
    TODOIST_IMPORT_USER_ID?: string;
    TODOIST_IMPORT_ID?: string;
    BUCKET?: R2Bucket;
  }
}
