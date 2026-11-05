import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceRecognition } from "../useVoiceRecognition";

/** Minimal stand-in for the browser's SpeechRecognition. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static availableResult: string | null = null;
  static available = vi.fn(async () => FakeRecognition.availableResult ?? "unavailable");
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  lang = "";
  processLocally = false;
  phrases: unknown[] = [];
  starts = 0;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.starts++; this.onstart?.(); }
  stop() {}
}

class FakePhrase {
  constructor(public phrase: string, public boost: number) {}
}

/** Build a result list the way the browser does: each result = array of alternatives. */
const result = (alts: string[], isFinal = true) =>
  Object.assign(alts.map((transcript) => ({ transcript })), { isFinal });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const mount = (bibs: string[], onBibDetected = vi.fn(), language: "en" | "he" = "en") =>
  renderHook((p: { language: "en" | "he" }) =>
    useVoiceRecognition({
      language: p.language, validBibs: new Set(bibs), commands: [], onBibDetected, onCommand: vi.fn(), enabled: true,
    }), { initialProps: { language } });

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.availableResult = null;
  (window as any).SpeechRecognition = FakeRecognition;
  (window as any).SpeechRecognitionPhrase = FakePhrase;
});
afterEach(() => {
  delete (window as any).SpeechRecognition;
  delete (window as any).SpeechRecognitionPhrase;
});

describe("useVoiceRecognition", () => {
  it("handles every result finalized in one event, not just the last", async () => {
    const onBib = vi.fn();
    mount(["12", "47"], onBib);
    await flush();
    const rec = FakeRecognition.instances[0];
    act(() => rec.onresult!({ resultIndex: 0, results: [result(["12"]), result(["47"])] }));
    expect(onBib.mock.calls.map((c) => c[0])).toEqual(["12", "47"]);
  });

  it("asks for several guesses and picks the one that is a real bib", async () => {
    const onBib = vi.fn();
    mount(["47"], onBib);
    await flush();
    const rec = FakeRecognition.instances[0];
    expect(rec.maxAlternatives).toBeGreaterThan(1);
    act(() => rec.onresult!({ resultIndex: 0, results: [result(["57", "47"])] }));
    expect(onBib).toHaveBeenCalledWith("47");
  });

  it("does not re-report results before resultIndex or interim results", async () => {
    const onBib = vi.fn();
    mount(["12", "47"], onBib);
    await flush();
    const rec = FakeRecognition.instances[0];
    act(() => rec.onresult!({ resultIndex: 1, results: [result(["12"]), result(["47"], false)] }));
    expect(onBib).not.toHaveBeenCalled();
  });

  it("restarts immediately when the browser ends the session", async () => {
    mount(["12"]);
    await flush();
    const rec = FakeRecognition.instances[0];
    expect(rec.starts).toBe(1);
    act(() => rec.onend!());
    expect(rec.starts).toBe(2);
  });

  it("still auto-restarts after a language change (old cleanup disabled it)", async () => {
    const { rerender } = mount(["12"]);
    await flush();
    rerender({ language: "he" });
    await flush();
    const rec = FakeRecognition.instances[1];
    expect(rec.lang).toBe("he-IL");
    expect(rec.starts).toBe(1);
    act(() => rec.onend!());
    expect(rec.starts).toBe(2);
  });

  it("biases toward the race's bibs when the browser supports phrases", async () => {
    mount(["12", "47"]);
    await flush();
    const rec = FakeRecognition.instances[0];
    expect((rec.phrases as FakePhrase[]).map((p) => p.phrase)).toEqual(["12", "47"]);
  });

  it("uses on-device recognition only when the model is already installed", async () => {
    FakeRecognition.availableResult = "available";
    const a = mount(["12"]);
    await flush();
    expect(FakeRecognition.instances[0].processLocally).toBe(true);
    expect(a.result.current.onDevice).toBe(true);
    a.unmount();

    FakeRecognition.availableResult = "downloadable";
    const b = mount(["12"]);
    await flush();
    expect(FakeRecognition.instances[1].processLocally).toBe(false);
    expect(b.result.current.onDevice).toBe(false);
  });

  it("falls back to the cloud engine if on-device refuses the language", async () => {
    FakeRecognition.availableResult = "available";
    const { result: r } = mount(["12"]);
    await flush();
    const rec = FakeRecognition.instances[0];
    act(() => rec.onerror!({ error: "language-not-supported" }));
    expect(rec.processLocally).toBe(false);
    expect(r.current.onDevice).toBe(false);
  });
});
