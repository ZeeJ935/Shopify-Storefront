/**
 * All storefront marketing copy lives here.
 * Items marked `demo: true` are placeholders for local demos — not live store policy.
 */

export const siteBrand = {
  name: "ZJ Store",
  tagline: "Performance gear from Nike and Adidas.",
};

/** Preferred brand order for tiles, nav, and facets. */
export const preferredBrands = ["Nike", "Adidas"] as const;

export type AnnouncementMessage = {
  id: string;
  text: string;
  href?: string;
  /** Demo placeholder — not a real store offer */
  demo?: boolean;
};

export const announcementMessages: AnnouncementMessage[] = [
  {
    id: "shipping",
    text: "Free shipping on orders over $75",
    href: "/collections/all",
  },
  {
    id: "sale",
    text: "Adidas sale styles — shop reduced prices",
    href: "/collections/sale",
  },
  {
    id: "new",
    text: "New arrivals drop weekly",
    href: "/collections/all?sort=latest",
  },
  {
    id: "student",
    text: "Student discount available at checkout",
  },
];

export type NavIntentId =
  | "catalog"
  | "men"
  | "women"
  | "kids"
  | "shoes"
  | "clothing"
  | "accessories"
  | "sale";

export type NavIntent = {
  id: NavIntentId;
  label: string;
  /** Prefer collection handle when present */
  collectionHandle?: string;
  /** Fallback for missing collections: product type browse */
  productType?: string;
  /** Link to full catalog */
  catalog?: boolean;
  megaMenu?: boolean;
};

export const primaryNavIntents: NavIntent[] = [
  { id: "catalog", label: "Catalog", catalog: true, megaMenu: true },
  { id: "men", label: "Men", collectionHandle: "men", megaMenu: true },
  { id: "women", label: "Women", collectionHandle: "women", megaMenu: true },
  { id: "kids", label: "Kids", collectionHandle: "kids", megaMenu: true },
  {
    id: "shoes",
    label: "Shoes",
    collectionHandle: "shoes",
    productType: "Shoes",
    megaMenu: true,
  },
  {
    id: "clothing",
    label: "Clothing",
    collectionHandle: "clothing",
    productType: "Clothing",
    megaMenu: true,
  },
  {
    id: "accessories",
    label: "Accessories",
    collectionHandle: "accessories",
    productType: "Accessories",
    megaMenu: true,
  },
  { id: "sale", label: "Sale", collectionHandle: "sale" },
];

export type HeroSlideConfig = {
  id: string;
  headline: string;
  subcopy: string;
  /** Collection handle used for hero imagery */
  imageFromCollection: string;
  primaryCta: { label: string; collectionHandle: string };
  secondaryCta: { label: string; collectionHandle: string };
};

export const heroSlides: HeroSlideConfig[] = [
  {
    id: "main",
    headline: "Gear for every mile",
    subcopy: "Shop Men and Women essentials from the live catalog.",
    imageFromCollection: "trending",
    primaryCta: { label: "Shop Men", collectionHandle: "men" },
    secondaryCta: { label: "Shop Women", collectionHandle: "women" },
  },
];

export type BenefitItem = {
  id: string;
  title: string;
  description: string;
  demo?: boolean;
};

export const brandBenefits: BenefitItem[] = [
  {
    id: "shipping",
    title: "Free shipping over $75",
    description: "Demo placeholder — not a live shipping policy.",
    demo: true,
  },
  {
    id: "returns",
    title: "Easy returns",
    description: "Demo placeholder — confirm return window in Shopify admin.",
    demo: true,
  },
  {
    id: "secure",
    title: "Secure checkout",
    description: "Checkout is handled by Shopify.",
  },
  {
    id: "support",
    title: "Help when you need it",
    description: "Demo placeholder contact channel.",
    demo: true,
  },
];

export type EditorialGuideConfig = {
  id: string;
  title: string;
  description: string;
  collectionHandle: string;
};

export const editorialGuides: EditorialGuideConfig[] = [
  {
    id: "men",
    title: "Men’s training",
    description: "Shoes and apparel built for the gym and the road.",
    collectionHandle: "men",
  },
  {
    id: "women",
    title: "Women’s essentials",
    description: "Everyday performance styles from the catalog.",
    collectionHandle: "women",
  },
  {
    id: "sale",
    title: "On sale now",
    description: "Reduced Adidas styles with compare-at pricing.",
    collectionHandle: "sale",
  },
];

export type FooterColumn = {
  title: string;
  links: { label: string; href: string; demo?: boolean }[];
};

export const footerColumns: FooterColumn[] = [
  {
    title: "Shop",
    links: [
      { label: "All products", href: "/collections/all" },
      { label: "Men", href: "/collections/men" },
      { label: "Women", href: "/collections/women" },
      { label: "Sale", href: "/collections/sale" },
    ],
  },
  {
    title: "Brands",
    links: [
      { label: "Nike", href: "/collections/all?brand=Nike" },
      { label: "Adidas", href: "/collections/all?brand=Adidas" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Shipping", href: "/#", demo: true },
      { label: "Returns", href: "/#", demo: true },
      { label: "Contact", href: "/#", demo: true },
      { label: "Cart", href: "/cart" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/#", demo: true },
      { label: "Stores", href: "/#", demo: true },
      { label: "Sustainability", href: "/#", demo: true },
    ],
  },
];

/** Demo social placeholders — not live profiles */
export const socialLinks = [
  { label: "Instagram", href: "#", demo: true as const },
  { label: "X / Twitter", href: "#", demo: true as const },
  { label: "YouTube", href: "#", demo: true as const },
];

export const paymentMethodsLabel =
  "Visa · Mastercard · Amex · Shop Pay · Apple Pay · Google Pay";

export const legalLinks = [
  { label: "Privacy", href: "/#", demo: true as const },
  { label: "Terms", href: "/#", demo: true as const },
];
