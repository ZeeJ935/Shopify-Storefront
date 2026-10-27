import { cacheLife } from "next/cache";
import { getCustomerAccountConfig } from "./config";

export type OpenIdConfiguration = {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  issuer?: string;
};

export type CustomerAccountDiscovery = {
  openid: OpenIdConfiguration;
  graphqlUrl: string;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getCustomerAccountDiscovery(): Promise<CustomerAccountDiscovery> {
  "use cache";
  cacheLife("hours");

  const { storeDomain, shopId, apiVersion } = getCustomerAccountConfig();

  const openidCandidates = [
    `https://${storeDomain}/.well-known/openid-configuration`,
    `https://shopify.com/authentication/${shopId}/.well-known/openid-configuration`,
  ];

  let openid: OpenIdConfiguration | null = null;
  for (const url of openidCandidates) {
    openid = await fetchJson<OpenIdConfiguration>(url);
    if (openid?.authorization_endpoint && openid.token_endpoint) {
      break;
    }
  }

  if (!openid?.authorization_endpoint || !openid.token_endpoint) {
    throw new Error("Unable to discover Customer Account OAuth endpoints.");
  }

  const apiConfig = await fetchJson<{ graphql_api?: string }>(
    `https://${storeDomain}/.well-known/customer-account-api`,
  );

  const graphqlUrl =
    apiConfig?.graphql_api?.trim() ||
    `https://shopify.com/${shopId}/account/customer/api/${apiVersion}/graphql`;

  return {
    openid,
    graphqlUrl,
  };
}
