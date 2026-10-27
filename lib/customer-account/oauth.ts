import { getCustomerAccountConfig } from "./config";
import { getCustomerAccountDiscovery } from "./discovery";
import {
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
} from "./pkce";
import {
  clearPkceCookie,
  getPkceCookie,
  setCustomerSession,
  setPkceCookie,
  type CustomerSession,
} from "./session";

const AUTH_SCOPES = "openid email customer-account-api:full";

export async function beginCustomerAuthorization() {
  const config = getCustomerAccountConfig();
  const { openid } = await getCustomerAccountDiscovery();

  const state = createOAuthState();
  const verifier = createCodeVerifier();
  const challenge = createCodeChallenge(verifier);

  await setPkceCookie({ state, verifier });

  const url = new URL(openid.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("scope", AUTH_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function postToken(body: URLSearchParams) {
  const config = getCustomerAccountConfig();
  const { openid } = await getCustomerAccountDiscovery();

  const basic = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");

  const response = await fetch(openid.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  const json = (await response.json()) as TokenResponse;
  if (!response.ok || !json.access_token || !json.refresh_token) {
    throw new Error(
      json.error_description || json.error || "Token exchange failed.",
    );
  }

  return json;
}

function toSession(
  token: TokenResponse,
  previous?: CustomerSession | null,
): CustomerSession {
  const expiresIn =
    typeof token.expires_in === "number" && token.expires_in > 0
      ? token.expires_in
      : 3600;

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    // Refresh responses often omit id_token — keep the previous one for logout.
    idToken: token.id_token || previous?.idToken,
  };
}

export async function completeCustomerAuthorization(input: {
  code: string;
  state: string;
}) {
  const config = getCustomerAccountConfig();
  const pkce = await getPkceCookie();

  if (!pkce || pkce.state !== input.state) {
    throw new Error("Invalid OAuth state.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    code: input.code,
    code_verifier: pkce.verifier,
  });

  const token = await postToken(body);
  await setCustomerSession(toSession(token));
  await clearPkceCookie();
}

export async function refreshCustomerSession(
  refreshToken: string,
  previous?: CustomerSession | null,
): Promise<CustomerSession> {
  const config = getCustomerAccountConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  const token = await postToken(body);
  const session = toSession(token, previous);
  await setCustomerSession(session);
  return session;
}

export async function buildCustomerLogoutUrl(idToken?: string) {
  const config = getCustomerAccountConfig();

  // Shopify requires a valid id_token_hint; without one, skip hosted logout.
  if (!idToken) {
    return config.logoutRedirectUrl;
  }

  const { openid } = await getCustomerAccountDiscovery();

  if (!openid.end_session_endpoint) {
    return config.logoutRedirectUrl;
  }

  const url = new URL(openid.end_session_endpoint);
  url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("post_logout_redirect_uri", config.logoutRedirectUrl);
  return url.toString();
}
