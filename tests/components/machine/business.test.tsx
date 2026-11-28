// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessView } from "@/components/machine/business/BusinessView";
import type { ExpensesResponse, MonthResponse } from "@/lib/salon/api";
import { demoShop, NOW } from "./machineFixtures";

/** Salon spec 2.3, 9.5, 9.6, 9.12: the month's three numbers, the receptionist's block, expenses and the export. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const chair = demoShop.resources[0].id;
const service = demoShop.services[0].id;

const REPORT: MonthResponse = {
  month: "2026-11",
  timeZone: "Europe/Madrid",
  takenCents: 250000,
  expensesCents: 90000,
  leftCents: 160000,
  comparedThrough: null,
  deltaPct: { taken: 12, expenses: -5, left: null },
  weeks: [
    { label: "2-8 nov", takenCents: 100000 },
    { label: "9-15", takenCents: 150000 },
  ],
  byWorker: [{ resourceId: chair, takenCents: 250000 }],
  topServices: [{ serviceId: service, count: 7, takenCents: 140000 }],
  noShows: 2,
  receptionist: { calls: 31, booked: 12, bookedValueCents: 48000, phoneSeconds: 5400, gapsRefilled: 0 },
};
const EXPENSES: ExpensesResponse = {
  month: "2026-11",
  totalCents: 90000,
  items: [
    { id: "e1", concept: "Alquiler", category: "rent", amountCents: 80000, day: "2026-11-01", recurring: true },
    { id: "e2", concept: "Tintes", category: "products", amountCents: 10000, day: "2026-11-04", recurring: false },
  ],
};

let posts: { url: string; body: Record<string, unknown> }[];
let deletes: string[];
let report: MonthResponse;
let reads: string[];

beforeEach(() => {
  posts = [];
  deletes = [];
  reads = [];
  report = REPORT;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ id: "new" });
      }
      if (init?.method === "DELETE") {
        deletes.push(url);
        return json({ ok: true });
      }
      reads.push(url);
      if (/\/month\?/.test(url)) return json({ ...report, month: new URL(url, "http://x").searchParams.get("month") });
      if (/\/expenses\?/.test(url)) return json(EXPENSES);
      return json({ error: "unavailable" }, 503);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function view(lang: "es" | "en" = "es", onLocked = () => {}) {
  render(<BusinessView shop={demoShop} lang={lang} active now={NOW} refreshKey={1} onLocked={onLocked} />);
}

describe("My business", () => {
  it("shows taken, expenses, left from the API with the change against last month", async () => {
    view();
    const taken = await screen.findByTestId("big-taken");
    expect(taken.textContent).toMatch(/2\.?500/);
    expect(taken.textContent).toMatch(/12\s?%.*mes pasado/);
    expect(taken.textContent).not.toMatch(/a esta altura/);
    expect(screen.getByTestId("big-expenses").textContent).toMatch(/900/);
    expect(screen.getByTestId("big-expenses").textContent).toMatch(/5\s?%/);
    expect(screen.getByTestId("big-left").textContent).toMatch(/1\.?600/);
    // No previous month to compare: no arrow on that figure.
    expect(screen.getByTestId("big-left").textContent).not.toMatch(/[▲▼]/);
    expect(screen.getByRole("heading", { name: /Lo que ha hecho tu recepcionista/ })).toBeTruthy();
    expect(screen.getByText("31")).toBeTruthy();
    expect(screen.getByText("2 no vinieron", { exact: false })).toBeTruthy();
  });

  it("says 'a esta altura' when the month so far is compared with the same days of last month", async () => {
    report = { ...REPORT, comparedThrough: 10 };
    view();
    const taken = await screen.findByTestId("big-taken");
    expect(taken.textContent).toMatch(/12\s?%.*mes pasado a esta altura/);
    expect(screen.getByTestId("big-expenses").textContent).toMatch(/a esta altura/);
  });

  it("hides gaps refilled at zero and shows it above zero", async () => {
    view();
    await screen.findByTestId("big-taken");
    expect(screen.queryByTestId("gaps-refilled")).toBeNull();
    cleanup();
    report = { ...REPORT, receptionist: { ...REPORT.receptionist, gapsRefilled: 3 } };
    view();
    expect((await screen.findByTestId("gaps-refilled")).textContent).toMatch(/3/);
  });

  it("lists the weekly bars, the worker and the top services by name", async () => {
    view();
    await screen.findByTestId("big-taken");
    expect(screen.getByText("Sem. 9–15 nov")).toBeTruthy();
    expect(screen.getAllByText(demoShop.resources[0].name.es).length).toBeGreaterThan(0);
    expect(screen.getAllByText(demoShop.services[0].name.es).length).toBeGreaterThan(0);
  });

  it("recurring expense posts recurring with a start day in the month", async () => {
    view();
    await screen.findByTestId("big-taken");
    fireEvent.click(screen.getByRole("button", { name: /\+ Gasto/ }));
    fireEvent.change(screen.getByLabelText("Concepto"), { target: { value: "Luz" } });
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "45,50" } });
    fireEvent.click(screen.getByRole("radio", { name: "Suministros" }));
    fireEvent.click(screen.getByLabelText("Se repite cada mes"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toMatch(/\/expenses$/);
    expect(posts[0].body).toMatchObject({ concept: "Luz", amountCents: 4550, category: "utilities", recurring: true });
    expect(String(posts[0].body.day)).toMatch(/^2026-11-\d\d$/);
    // The list is read again after saving.
    await waitFor(() => expect(reads.filter((u) => /\/expenses\?/.test(u)).length).toBeGreaterThan(1));
  });

  it("refuses a bad amount without calling the server", async () => {
    view();
    await screen.findByTestId("big-taken");
    fireEvent.click(screen.getByRole("button", { name: /\+ Gasto/ }));
    fireEvent.change(screen.getByLabelText("Concepto"), { target: { value: "Luz" } });
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(posts).toHaveLength(0);
  });

  it("deletes an expense after asking", async () => {
    view();
    await screen.findByText("Tintes");
    const row = screen.getByText("Tintes").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Borrar/ }));
    fireEvent.click(within(row).getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(deletes[0]).toMatch(/\/expenses\/e2$/);
  });

  it("export link has the month and the language", async () => {
    view("en");
    await screen.findByTestId("big-taken");
    const link = screen.getByRole("link", { name: /accountant/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`/api/machine/${demoShop.id}/export?month=2026-11&format=csv&lang=en`);
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("moves between months and reads the new one", async () => {
    view();
    await screen.findByTestId("big-taken");
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    await waitFor(() => expect(reads.some((u) => u.includes("month=2026-10"))).toBe(true));
    expect(screen.getByRole("heading", { name: /octubre de 2026/i })).toBeTruthy();
  });

  it("goes back to the gate on 401 and shows a failure note on 503", async () => {
    const locked = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "locked" }, 401)));
    view("es", locked);
    await waitFor(() => expect(locked).toHaveBeenCalled());
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "unavailable" }, 503)));
    view();
    expect(await screen.findByText(/No se pudo cargar/)).toBeTruthy();
  });
});
