import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrubEvent } from "../lib/sentry-scrub";

describe("Sentry scrubbing", () => {
  it("never sends staff emails, tokens, cookies or the staff identity", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6Im9wQHguY29tIn0.c2lnbmF0dXJl";
    const event = scrubEvent({
      message: "backend refused op@x.com",
      user: { email: "op@x.com", id: "1" },
      tags: { staff_email: "op@x.com", route: "/orders" },
      request: {
        url: "https://admin.example.com/auth/callback?code=abc&state=xyz",
        data: "body",
        cookies: { "zj-admin-session": "sealed" },
        headers: { authorization: "Bearer T", "x-staff-token": jwt, "x-forwarded-for": "203.0.113.1", "user-agent": "ua" },
      },
      exception: { values: [{ value: `token ${jwt} for admin@x.com` }] },
      breadcrumbs: [{ message: "signed in as op@x.com", data: { url: "/x?nonce=1", staffEmail: "op@x.com" } }],
      extra: { email: "op@x.com", note: "contact op@x.com" },
    });
    const json = JSON.stringify(event);
    assert.ok(!json.includes("op@x.com") && !json.includes("admin@x.com"), json);
    assert.ok(!json.includes(jwt));
    assert.ok(!json.includes("sealed"));
    assert.ok(!Object.keys(event).includes("user"));
    assert.equal(event.request.url, "https://admin.example.com/auth/callback");
    assert.equal(event.request.headers["x-staff-token"], "[redacted]");
    assert.equal(event.request.headers["x-forwarded-for"], "[redacted]");
    assert.equal(event.request.headers["user-agent"], "ua");
    assert.equal(event.tags.route, "/orders");
  });
});
