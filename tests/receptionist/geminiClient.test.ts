import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server environment; the client itself is what is tested here.
vi.mock("server-only", () => ({}));

const { createGeminiClient, geminiClientFromEnv, DEFAULT_GEMINI_MODEL } = await import("@/lib/receptionist/geminiClient");
type InteractionsApi = import("@/lib/receptionist/geminiClient").InteractionsApi;

function fakeSdk(outputText = '{"ok":true}') {
  const create = vi.fn<InteractionsApi["interactions"]["create"]>(async () => ({ output_text: outputText }));
  return { sdk: { interactions: { create } } satisfies InteractionsApi, create };
}

describe("createGeminiClient", () => {
  it("sends store: false, response_format, thinking_level, the signal and no retries", async () => {
    const { sdk, create } = fakeSdk();
    const client = createGeminiClient({ apiKey: "test-key", model: "gemini-test", sdk });
    const signal = new AbortController().signal;
    const schema = { type: "object" };
    await expect(client.generate({ systemInstruction: "SYS", input: "IN", jsonSchema: schema, signal })).resolves.toBe('{"ok":true}');

    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0];
    expect(params).toEqual({
      model: "gemini-test",
      system_instruction: "SYS",
      input: "IN",
      store: false,
      response_format: { type: "text", mime_type: "application/json", schema },
      generation_config: { thinking_level: "low", max_output_tokens: 400 },
    });
    expect(options.signal).toBe(signal);
    expect(options.retries).toEqual({ strategy: "none" });
    expect(options).not.toHaveProperty("fetch_options");
  });

  it("sends no sampling parameters", async () => {
    const { sdk, create } = fakeSdk();
    await createGeminiClient({ apiKey: "k", sdk }).generate({
      systemInstruction: "s",
      input: "i",
      jsonSchema: {},
      signal: new AbortController().signal,
    });
    const json = JSON.stringify(create.mock.calls[0][0]);
    for (const key of ["temperature", "top_p", "top_k", "topP", "topK"]) expect(json).not.toContain(key);
  });

  it("uses the default model when GEMINI_MODEL is empty", async () => {
    const { sdk, create } = fakeSdk();
    await createGeminiClient({ apiKey: "k", model: "  ", sdk }).generate({
      systemInstruction: "s",
      input: "i",
      jsonSchema: {},
      signal: new AbortController().signal,
    });
    expect(create.mock.calls[0][0].model).toBe(DEFAULT_GEMINI_MODEL);
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
  });

  it("returns an empty string when the interaction has no output_text", async () => {
    const create = vi.fn<InteractionsApi["interactions"]["create"]>(async () => ({}));
    const client = createGeminiClient({ apiKey: "k", sdk: { interactions: { create } } });
    await expect(
      client.generate({ systemInstruction: "s", input: "i", jsonSchema: {}, signal: new AbortController().signal }),
    ).resolves.toBe("");
  });

  it("from the environment: a missing key fails without printing anything secret", () => {
    expect(() => geminiClientFromEnv({})).toThrow("GEMINI_API_KEY is not set");
  });
});
