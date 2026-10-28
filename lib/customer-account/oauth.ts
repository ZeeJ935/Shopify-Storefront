import { NextResponse } from "next/server";
import { safeReturnTo } from "@/lib/favourites";
import { getCustomerAccountConfig } from "./config";
import { getCustomerAccountDiscovery } from "./discovery";
import {
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
} from "./pkce";
import {
  applyCustomerSession,
  applyPkceCookie,
  clearPkceCookie,
  getPkceCookie,
  type CustomerSession,
} from "./session";

const AUTH_SCOPES = "openid email customer-account-api:full";

export async function beginCustomerAuthorization(requestUrl: string) {
  const config = getCustomerAccountConfig();
  const { openid } = await getCustomerAccountDiscovery();

  const state = createOAuthState();
  const verifier = createCodeVerifier();
  const challenge = createCodeChallenge(verifier);
  const returnTo = safeReturnTo(
    new URL(requestUrl).searchParams.get("returnTo"),
  );

  const url = new URL(openid.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("scope", AUTH_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(url.toString(), 302);
  applyPkceCookie(response, { state, verifier, returnTo });
  return response;
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
  const expiresIn = Number(token.expires_in);
  const seconds =
    Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + seconds * 1000,
    idToken: token.id_token || previous?.idToken,
  };
}

export async function completeCustomerAuthorization(input: {
  code: string;
  state: string;
  requestUrl: string;
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
  const session = toSession(token);
  const returnTo = safeReturnTo(pkce.returnTo);

  const response = NextResponse.redirect(
    new URL(returnTo, input.requestUrl),
    302,
  );
  applyCustomerSession(response, session);
  clearPkceCookie(response);
  return response;
}

export async function refreshCustomerSessionTokens(
  previous: CustomerSession,
): Promise<CustomerSession> {
  const config = getCustomerAccountConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: previous.refreshToken,
  });

  const token = await postToken(body);
  return toSession(token, previous);
}

export async function buildCustomerLogoutUrl(idToken?: string) {
  const config = getCustomerAccountConfig();

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
