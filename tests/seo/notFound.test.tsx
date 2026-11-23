// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getShop = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getRepository: () => ({ getShop }) }));
const loadMachine = vi.hoisted(() => vi.fn());
vi.mock("@/app/machine/[shopId]/loadMachine", () => ({ loadMachine }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));

import { MachineGate } from "@/app/machine/[shopId]/MachineGate";
import NotFound from "@/app/not-found";
import { config, proxy } from "@/proxy";

// BACKLOG 28: an unknown shop answers 404, with the brand's not-found page in ES + EN.
const req = (path: string) => ({ nextUrl: new URL(`http://localhost${path}`), url: `http://localhost${path}` }) as never;
const rewritten = (res: Response) => res.headers.get("x-middleware-rewrite");
beforeEach(() => {
  getShop.mockReset();
});
afterEach(cleanup);

describe("unknown shop", () => {
  it("not-found page says it in Spanish and English and links home", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Este número no existe");
    expect(document.querySelector("p[lang='en']")?.textContent).toMatch(/Shop not found/);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/");
  });

  it("the proxy covers the call and machine routes only", () => {
    expect(config.matcher).toEqual(["/call/:shopId", "/machine/:shopId"]);
  });

  it("the proxy rewrites an unknown, malformed or over-long shop to the 404 page", async () => {
    getShop.mockResolvedValue(null);
    expect(rewritten(await proxy(req("/call/unknown-shop")))).toContain("/shop-not-found");
    expect(rewritten(await proxy(req("/machine/unknown-shop")))).toContain("/shop-not-found");
    expect(rewritten(await proxy(req("/call/%E0%A4%A")))).toContain("/shop-not-found");
    expect(rewritten(await proxy(req(`/call/${"a".repeat(101)}`)))).toContain("/shop-not-found");
    expect(getShop).toHaveBeenCalledTimes(2);
  });

  it("the proxy lets a known shop through, and a database failure too", async () => {
    getShop.mockResolvedValue({ id: "peluqueria-lola" });
    expect(rewritten(await proxy(req("/call/peluqueria-lola")))).toBeNull();
    getShop.mockImplementation(() => {
      throw new Error("db down");
    });
    expect(rewritten(await proxy(req("/call/peluqueria-lola")))).toBeNull();
  });

  it("the machine page calls notFound() for an unknown shop", async () => {
    loadMachine.mockResolvedValue({ kind: "not_found" });
    await expect(MachineGate({ params: Promise.resolve({ shopId: "nope" }) })).rejects.toThrow("404");
    await expect(MachineGate({ params: Promise.resolve({ shopId: "%E0%A4%A" }) })).rejects.toThrow("404");
  });
});
