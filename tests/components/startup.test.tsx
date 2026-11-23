// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartupPage } from "@/components/startup/StartupPage";
import { WaitlistForm } from "@/components/startup/WaitlistForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fill = (lang: "es" | "en" = "en") => {
  const labels = lang === "en" ? ["Shop name", "City", "Email"] : ["Nombre del local", "Ciudad", "Correo electrónico"];
  fireEvent.change(screen.getByLabelText(labels[0]!), { target: { value: "Lola" } });
  fireEvent.change(screen.getByLabelText(labels[1]!), { target: { value: "Madrid" } });
  fireEvent.change(screen.getByLabelText(labels[2]!), { target: { value: "lola@example.com" } });
};

describe("WaitlistForm", () => {
  it("does not call the server without consent and says why", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitlistForm lang="en" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    expect((await screen.findByRole("alert")).textContent).toContain("consent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the fields with consent true and shows the thanks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitlistForm lang="en" />);
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("on the list"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/waitlist");
    expect(JSON.parse(init.body)).toEqual({ shopName: "Lola", city: "Madrid", email: "lola@example.com", language: "en", consent: true });
  });

  it("shows the rate limit message in Spanish", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
    render(<WaitlistForm lang="es" />);
    fill("es");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Apuntarme a la lista" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Demasiados");
  });
});

describe("StartupPage", () => {
  it("has the founder line, planned pricing and roadmap tags, and switches to Spanish", async () => {
    render(<StartupPage />);
    expect(screen.getByText("Founded by Miguel Morente, student at UFV Madrid")).toBeTruthy();
    expect(screen.getByText(/Planned pricing\. Nothing is charged/)).toBeTruthy();
    expect(screen.getAllByText(/Roadmap, not built yet/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect(screen.getByText("Fundada por Miguel Morente, estudiante de la UFV de Madrid")).toBeTruthy();
    expect(screen.getByText(/Precios previstos\. Hoy no se cobra/)).toBeTruthy();
  });
});
