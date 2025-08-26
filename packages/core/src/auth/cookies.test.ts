import { describe, it, expect } from "vitest";
import { parseCookies, setCookie, clearCookie } from "../auth/cookies.js";

describe("cookies helpers", () => {
  it("parses cookie header into map", () => {
    const out = parseCookies({ headers: { cookie: "a=1; b=hello%20world" } } as any);
    expect(out).toEqual({ a: "1", b: "hello world" });
  });

  it("setCookie sets header with options", () => {
    const headers: Record<string, string | string[]> = {};
    const res = {
      header(name: string, value: string | string[]) {
        headers[name] = value;
        return this as any;
      },
      status() {
        return this as any;
      },
      json() {},
      redirect() {},
    } as any;
    setCookie(res, "sid", "abc", {
      secure: true,
      domain: "example.com",
      sameSite: "Lax",
      maxAgeSec: 60,
    });
    expect(String(headers["Set-Cookie"]).includes("sid=abc")).toBe(true);
    expect(String(headers["Set-Cookie"]).includes("Secure")).toBe(true);
    expect(String(headers["Set-Cookie"]).includes("Domain=example.com")).toBe(true);
  });

  it("clearCookie clears with Max-Age=0", () => {
    const headers: Record<string, string | string[]> = {};
    const res = {
      header(name: string, value: string | string[]) {
        headers[name] = value;
        return this as any;
      },
      status() {
        return this as any;
      },
      json() {},
      redirect() {},
    } as any;
    clearCookie(res, "sid", {});
    expect(String(headers["Set-Cookie"]).includes("Max-Age=0")).toBe(true);
  });
});
