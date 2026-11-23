import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loadPublicShop = vi.hoisted(() => vi.fn());
vi.mock("@/app/call/[shopId]/loadPublicShop", () => ({ loadPublicShop }));

import { generateMetadata as callMeta } from "@/app/call/[shopId]/page";
import { generateMetadata as machineMeta } from "@/app/machine/[shopId]/page";
import { callTitle, machineTitle } from "@/lib/seo/titles";

// BACKLOG 27: one title per route.
const arg = (shopId: string) => ({ params: Promise.resolve({ shopId }) }) as never;
beforeEach(() => {
  loadPublicShop.mockReset();
});

describe("page titles", () => {
  it("pure titles in both languages", () => {
    expect(callTitle("Peluquería Lola", "es")).toBe("Llama a Peluquería Lola · Phantom Line");
    expect(callTitle("Lola's Salon", "en")).toBe("Call Lola's Salon · Phantom Line");
    expect(machineTitle("es")).toBe("Contestador · Phantom Line");
    expect(machineTitle("en")).toBe("Answering machine · Phantom Line");
  });

  it("call page: the shop's name, in the shop's first language", async () => {
    loadPublicShop.mockResolvedValue({ name: "Peluquería Lola", languages: ["es", "en"] });
    expect(await callMeta(arg("peluqueria-lola"))).toEqual({ title: "Llama a Peluquería Lola · Phantom Line" });
    loadPublicShop.mockResolvedValue({ name: "Barber Joe", languages: ["en"] });
    expect(await callMeta(arg("joe"))).toEqual({ title: "Call Barber Joe · Phantom Line" });
  });

  it("machine page: the route's own title", async () => {
    loadPublicShop.mockResolvedValue({ name: "Peluquería Lola", languages: ["es", "en"] });
    expect(await machineMeta(arg("peluqueria-lola"))).toEqual({ title: "Contestador · Phantom Line" });
    loadPublicShop.mockResolvedValue({ name: "Barber Joe", languages: ["en"] });
    expect(await machineMeta(arg("joe"))).toEqual({ title: "Answering machine · Phantom Line" });
  });

  it("unknown shop, malformed id and a failed lookup never throw", async () => {
    loadPublicShop.mockResolvedValue(null);
    expect(((await callMeta(arg("nope"))) as { title: string }).title).toContain("no existe");
    expect(((await machineMeta(arg("nope"))) as { title: string }).title).toContain("no existe");
    expect(((await callMeta(arg("%E0%A4%A"))) as { title: string }).title).toContain("no existe");
    expect(((await machineMeta(arg("%E0%A4%A"))) as { title: string }).title).toContain("no existe");
  });

  it("a failed lookup keeps the default title", async () => {
    loadPublicShop.mockImplementation(() => {
      throw new Error("db down");
    });
    expect(await callMeta(arg("x"))).toEqual({});
    expect(await machineMeta(arg("x"))).toEqual({});
  });
});
