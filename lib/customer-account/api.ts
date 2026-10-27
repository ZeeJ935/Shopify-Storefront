import { redirect, unstable_rethrow } from "next/navigation";
import { getCustomerAccountDiscovery } from "./discovery";
import {
  getCustomerSession,
  isSessionExpiringSoon,
  type CustomerSession,
} from "./session";

export type CustomerProfile = {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

export type CustomerAddress = {
  id: string;
  formatted: string[];
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
  phoneNumber: string | null;
};

export type CustomerOrderLine = {
  title: string;
  quantity: number;
  variantTitle: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  price: { amount: string; currencyCode: string } | null;
};

export type CustomerOrderSummary = {
  id: string;
  number: number | null;
  name: string;
  processedAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  totalPrice: { amount: string; currencyCode: string } | null;
};

export type CustomerOrderDetail = CustomerOrderSummary & {
  subtotal: { amount: string; currencyCode: string } | null;
  totalShipping: { amount: string; currencyCode: string } | null;
  totalTax: { amount: string; currencyCode: string } | null;
  lines: CustomerOrderLine[];
  fulfillments: {
    status: string | null;
    trackingCompany: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  }[];
};

async function requireAccessToken(returnTo: string): Promise<CustomerSession> {
  const session = await getCustomerSession();
  if (!session) {
    redirect("/account/authorize");
  }

  if (isSessionExpiringSoon(session)) {
    redirect(
      `/account/refresh?return_to=${encodeURIComponent(returnTo)}`,
    );
  }

  return session;
}

export async function customerAccountFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
  options?: { returnTo?: string },
): Promise<T> {
  const returnTo = options?.returnTo ?? "/account";
  const session = await requireAccessToken(returnTo);
  const { graphqlUrl } = await getCustomerAccountDiscovery();

  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: session.accessToken,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (response.status === 401) {
    redirect(
      `/account/refresh?return_to=${encodeURIComponent(returnTo)}`,
    );
  }

  const raw = await response.text();
  let result: {
    data?: T;
    errors?: { message: string }[];
  };

  try {
    result = JSON.parse(raw) as typeof result;
  } catch {
    throw new Error(
      `Customer Account API returned non-JSON (${response.status}).`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Customer Account API failed: ${response.status}${
        result.errors?.length
          ? ` — ${result.errors.map((e) => e.message).join(", ")}`
          : ""
      }`,
    );
  }

  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join(", "));
  }

  if (result.data === undefined || result.data === null) {
    throw new Error("Customer Account API returned no data.");
  }

  return result.data;
}

export async function getCustomerProfile(): Promise<CustomerProfile> {
  try {
    const data = await customerAccountFetch<{
      customer: {
        id: string;
        displayName: string;
        firstName: string | null;
        lastName: string | null;
        emailAddress: { emailAddress: string } | null;
      };
    }>(
      `
      query CustomerProfile {
        customer {
          id
          displayName
          firstName
          lastName
          emailAddress {
            emailAddress
          }
        }
      }
    `,
      {},
      { returnTo: "/account" },
    );

    return {
      id: data.customer.id,
      displayName: data.customer.displayName,
      firstName: data.customer.firstName,
      lastName: data.customer.lastName,
      email: data.customer.emailAddress?.emailAddress ?? null,
    };
  } catch (error) {
    unstable_rethrow(error);

    const data = await customerAccountFetch<{
      customer: {
        id: string;
        displayName: string;
        firstName: string | null;
        lastName: string | null;
      };
    }>(
      `
      query CustomerProfileBasic {
        customer {
          id
          displayName
          firstName
          lastName
        }
      }
    `,
      {},
      { returnTo: "/account" },
    );

    return {
      id: data.customer.id,
      displayName: data.customer.displayName,
      firstName: data.customer.firstName,
      lastName: data.customer.lastName,
      email: null,
    };
  }
}

export async function getCustomerAddresses(): Promise<CustomerAddress[]> {
  const data = await customerAccountFetch<{
    customer: {
      addresses: {
        nodes: {
          id: string;
          formatted: string[];
          firstName: string | null;
          lastName: string | null;
          address1: string | null;
          address2: string | null;
          city: string | null;
          zoneCode: string | null;
          zip: string | null;
          countryCode: string | null;
          phoneNumber: string | null;
        }[];
      };
    };
  }>(
    `
    query CustomerAddresses {
      customer {
        addresses(first: 20) {
          nodes {
            id
            formatted
            firstName
            lastName
            address1
            address2
            city
            zoneCode
            zip
            countryCode
            phoneNumber
          }
        }
      }
    }
  `,
    {},
    { returnTo: "/account/addresses" },
  );

  return data.customer.addresses.nodes.map((address) => ({
    id: address.id,
    formatted: address.formatted,
    firstName: address.firstName,
    lastName: address.lastName,
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.zoneCode,
    zip: address.zip,
    country: address.countryCode,
    phoneNumber: address.phoneNumber,
  }));
}

export async function getCustomerOrders(options?: {
  first?: number;
  after?: string | null;
}): Promise<{
  orders: CustomerOrderSummary[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
  const first = options?.first ?? 10;
  const data = await customerAccountFetch<{
    customer: {
      orders: {
        nodes: {
          id: string;
          number: number;
          name: string;
          processedAt: string;
          financialStatus: string | null;
          fulfillmentStatus: string | null;
          totalPrice: { amount: string; currencyCode: string };
        }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  }>(
    `
    query CustomerOrders($first: Int!, $after: String) {
      customer {
        orders(first: $first, after: $after, sortKey: PROCESSED_AT, reverse: true) {
          nodes {
            id
            number
            name
            processedAt
            financialStatus
            fulfillmentStatus
            totalPrice {
              amount
              currencyCode
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `,
    { first, after: options?.after ?? null },
    { returnTo: "/account/orders" },
  );

  return {
    orders: data.customer.orders.nodes.map((order) => ({
      id: order.id,
      number: order.number,
      name: order.name,
      processedAt: order.processedAt,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      totalPrice: order.totalPrice,
    })),
    pageInfo: data.customer.orders.pageInfo,
  };
}

export async function getCustomerOrderById(
  id: string,
): Promise<CustomerOrderDetail | null> {
  try {
    const data = await customerAccountFetch<{
      order: {
        id: string;
        number: number;
        name: string;
        processedAt: string;
        financialStatus: string | null;
        fulfillmentStatus: string | null;
        totalPrice: { amount: string; currencyCode: string };
        subtotal?: { amount: string; currencyCode: string } | null;
        totalShipping?: { amount: string; currencyCode: string } | null;
        totalTax?: { amount: string; currencyCode: string } | null;
        lineItems: {
          nodes: {
            title: string;
            quantity: number;
            variantTitle: string | null;
            image: { url: string; altText: string | null } | null;
            price: { amount: string; currencyCode: string } | null;
          }[];
        };
        fulfillments: {
          nodes: {
            status: string | null;
            trackingInformation: {
              company: string | null;
              number: string | null;
              url: string | null;
            }[];
          }[];
        };
      } | null;
    }>(
      `
      query CustomerOrder($id: ID!) {
        order(id: $id) {
          id
          number
          name
          processedAt
          financialStatus
          fulfillmentStatus
          totalPrice {
            amount
            currencyCode
          }
          subtotal {
            amount
            currencyCode
          }
          totalShipping {
            amount
            currencyCode
          }
          totalTax {
            amount
            currencyCode
          }
          lineItems(first: 50) {
            nodes {
              title
              quantity
              variantTitle
              image {
                url
                altText
              }
              price {
                amount
                currencyCode
              }
            }
          }
          fulfillments(first: 10) {
            nodes {
              status
              trackingInformation {
                company
                number
                url
              }
            }
          }
        }
      }
    `,
      { id },
      { returnTo: `/account/orders/${encodeURIComponent(id)}` },
    );

    if (!data.order) return null;

    const order = data.order;
    return {
      id: order.id,
      number: order.number,
      name: order.name,
      processedAt: order.processedAt,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      totalPrice: order.totalPrice,
      subtotal: order.subtotal ?? null,
      totalShipping: order.totalShipping ?? null,
      totalTax: order.totalTax ?? null,
      lines: order.lineItems.nodes.map((line) => ({
        title: line.title,
        quantity: line.quantity,
        variantTitle: line.variantTitle,
        imageUrl: line.image?.url ?? null,
        imageAlt: line.image?.altText ?? null,
        price: line.price,
      })),
      fulfillments: order.fulfillments.nodes.flatMap((fulfillment) => {
        if (
          !fulfillment.trackingInformation ||
          fulfillment.trackingInformation.length === 0
        ) {
          return [
            {
              status: fulfillment.status,
              trackingCompany: null,
              trackingNumber: null,
              trackingUrl: null,
            },
          ];
        }
        return fulfillment.trackingInformation.map((track) => ({
          status: fulfillment.status,
          trackingCompany: track.company,
          trackingNumber: track.number,
          trackingUrl: track.url,
        }));
      }),
    };
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
