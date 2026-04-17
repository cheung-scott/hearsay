"use client";

import { useState } from "react";

type PlayState = "idle" | "loading" | "playing" | "error";

export default function Home() {
  const [state, setState] = useState<PlayState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function playTestVoice() {
    setState("loading");
    setErrorMessage(null);
    try {
      const response = await fetch("/api/ping-voice", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; detail?: string }
          | null;
        throw new Error(
          body?.detail ?? body?.error ?? `HTTP ${response.status}`,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        setState("idle");
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setState("error");
        setErrorMessage("Audio playback failed");
        URL.revokeObjectURL(url);
      };
      setState("playing");
      await audio.play();
    } catch (err) {
      setState("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const buttonLabel = {
    idle: "Play test voice",
    loading: "Calling ElevenLabs…",
    playing: "Playing…",
    error: "Retry",
  }[state];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 py-16 font-sans text-zinc-100">
      <main className="flex w-full max-w-xl flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-6xl font-semibold tracking-tight text-zinc-50">
            Hearsay
          </h1>
          <p className="text-lg text-zinc-400">
            You lie with your voice. It lies back.
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">
            Day&nbsp;1&nbsp;·&nbsp;voice smoke test
          </p>
        </div>

        <button
          type="button"
          onClick={playTestVoice}
          disabled={state === "loading" || state === "playing"}
          className="rounded-full border border-zinc-700 bg-zinc-950 px-8 py-4 text-sm font-medium uppercase tracking-[0.15em] text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>

        {state === "error" && errorMessage ? (
          <p
            role="alert"
            className="max-w-md text-sm text-rose-400"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col items-center gap-2 text-xs text-zinc-600">
          <p>
            An ElevenHacks Kiro hackathon build. Built with Next.js 16, ElevenLabs
            Flash v2.5, Gemini 2.5 Flash, and Kiro spec-driven dev.
          </p>
          <a
            href="https://github.com/cheung-scott/hearsay"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-zinc-400"
          >
            github.com/cheung-scott/hearsay
          </a>
        </div>
      </main>
    </div>
  );
}
