export type CustomerAccountConfig = {
  storeDomain: string;
  shopId: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  logoutRedirectUrl: string;
  sessionSecret: string;
  apiVersion: string;
};

export function getCustomerAccountConfig(): CustomerAccountConfig {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const shopId = process.env.SHOPIFY_CUSTOMER_ACCOUNT_SHOP_ID?.trim();
  const clientId = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID?.trim();
  const clientSecret =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET?.trim();
  const callbackUrl =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_CALLBACK_URL?.trim();
  const logoutRedirectUrl =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_REDIRECT_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    (callbackUrl ? new URL(callbackUrl).origin : undefined);
  const sessionSecret =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_SESSION_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim();

  if (
    !storeDomain ||
    !shopId ||
    !clientId ||
    !clientSecret ||
    !callbackUrl ||
    !logoutRedirectUrl ||
    !sessionSecret
  ) {
    throw new Error("Missing Shopify Customer Account environment variables.");
  }

  if (sessionSecret.length < 32) {
    throw new Error(
      "SHOPIFY_CUSTOMER_ACCOUNT_SESSION_SECRET must be at least 32 characters.",
    );
  }

  return {
    storeDomain,
    shopId,
    clientId,
    clientSecret,
    callbackUrl,
    logoutRedirectUrl,
    sessionSecret,
    apiVersion: "2026-10",
  };
}

export function isCustomerAccountConfigured(): boolean {
  try {
    getCustomerAccountConfig();
    return true;
  } catch {
    return false;
  }
}
