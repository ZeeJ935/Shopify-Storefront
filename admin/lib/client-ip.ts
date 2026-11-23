// The browser's IP as seen by Vercel (first x-forwarded-for entry), for backend rate limiting.
const IP = /^[0-9A-Fa-f:.]{2,45}$/;

export function clientIpFrom(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim();
  return candidate && IP.test(candidate) ? candidate : undefined;
}
