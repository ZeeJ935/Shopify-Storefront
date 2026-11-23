// Server-only configuration. Throws with the variable NAME (never its value) when missing.
export type AdminAppConfig = {
  backendUrl: string;
  adminApiToken: string;
  googleClientId: string;
  googleClientSecret: string;
  sessionSecret: string;
  appUrl: string;
  /** Cookies only over HTTPS outside local development. */
  secureCookies: boolean;
};

export function readConfig(source: NodeJS.ProcessEnv = process.env): AdminAppConfig {
  const get = (name: string) => {
    const v = source[name]?.trim();
    if (!v) throw new Error(`${name} must be set for the admin app.`);
    return v;
  };
  const sessionSecret = get("ADMIN_SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters.");
  const appUrl = get("ADMIN_APP_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(appUrl)) throw new Error("ADMIN_APP_URL must start with http:// or https://.");
  return {
    backendUrl: get("BACKEND_URL").replace(/\/+$/, ""),
    adminApiToken: get("ADMIN_API_TOKEN"),
    googleClientId: get("GOOGLE_CLIENT_ID"),
    googleClientSecret: get("GOOGLE_CLIENT_SECRET"),
    sessionSecret,
    appUrl,
    secureCookies: appUrl.startsWith("https://"),
  };
}
