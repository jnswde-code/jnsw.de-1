"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";

type ChatMessage = {
  id: string;
  from: "me" | "agent";
  text: string;
};

type ConnectionState = "idle" | "connecting" | "connected" | "error";

const STATE_LABELS: Record<ConnectionState, string> = {
  idle: "Nicht verbunden",
  connecting: "Verbindet …",
  connected: "Verbunden",
  error: "Fehler",
};

export function SupportKiWorkbench() {
  const rootRef = useRef<HTMLElement>(null);
  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [micOn, setMicOn] = useState(false);

  const appendMessage = useCallback((from: ChatMessage["from"], text: string) => {
    setMessages((current) => [...current, { id: crypto.randomUUID(), from, text }]);
  }, []);

  const ensureConnected = useCallback(async () => {
    if (roomRef.current) return roomRef.current;
    setState("connecting");
    setError(null);
    const response = await fetch("/api/support-ki/token", { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        (body as { error?: string } | null)?.error ?? "Verbindung zur Support-KI fehlgeschlagen.",
      );
    }
    const { url, token } = (await response.json()) as { url: string; token: string };
    const room = new Room();
    room.registerTextStreamHandler("lk.transcription", async (reader) => {
      const text = await reader.readAll();
      if (text.trim()) appendMessage("agent", text);
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        audioContainerRef.current?.appendChild(element);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());
    });
    room.on(RoomEvent.Disconnected, () => {
      roomRef.current = null;
      setState("idle");
      setMicOn(false);
    });
    await room.connect(url, token);
    roomRef.current = room;
    setState("connected");
    return room;
  }, [appendMessage]);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setError(null);
    try {
      const room = await ensureConnected();
      await room.localParticipant.sendText(text, { topic: "lk.chat" });
      appendMessage("me", text);
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Nachricht konnte nicht gesendet werden.");
    }
  }, [draft, ensureConnected, appendMessage]);

  const toggleCall = useCallback(async () => {
    setError(null);
    try {
      const room = await ensureConnected();
      const next = !micOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "Mikrofonzugriff für die Support-KI fehlgeschlagen.",
      );
    }
  }, [ensureConnected, micOn]);

  useEffect(() => {
    const dialog = rootRef.current?.closest("dialog");
    if (!dialog) return;
    const disconnect = () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
    dialog.addEventListener("close", disconnect);
    return () => {
      dialog.removeEventListener("close", disconnect);
      disconnect();
    };
  }, []);

  return (
    <section className="support-ki-tool" aria-labelledby="support-ki-tool-title" ref={rootRef}>
      <p className="eyebrow">Support-KI / SimpliSan</p>
      <h3 id="support-ki-tool-title">Chat & Anruf mit dem Support-Assistenten</h3>
      <p>
        Verbindet dich live mit dem Support-KI-Agenten. Ohne laufenden Agenten auf der Gegenseite
        bleibt eine Nachricht unbeantwortet.
      </p>
      {error && <p className="support-ki-error">{error}</p>}
      <div className="support-ki-status">
        <span className={`support-ki-state support-ki-state-${state}`}>{STATE_LABELS[state]}</span>
        <button type="button" className="button" onClick={() => void toggleCall()}>
          {micOn ? "Auflegen" : "Anruf simulieren"}
        </button>
      </div>
      <div className="support-ki-messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <p className="support-ki-empty">
            Noch keine Nachrichten. Schreib etwas oder simuliere einen Anruf, um zu starten.
          </p>
        )}
        {messages.map((message) => (
          <p key={message.id} className={`support-ki-message support-ki-message-${message.from}`}>
            <span>{message.from === "me" ? "Du" : "Support-KI"}</span>
            {message.text}
          </p>
        ))}
      </div>
      <form
        className="support-ki-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Nachricht an die Support-KI …"
          aria-label="Nachricht an die Support-KI"
        />
        <button type="submit" className="button button-primary" disabled={!draft.trim()}>
          Senden
        </button>
      </form>
      <div ref={audioContainerRef} className="visually-hidden" aria-hidden="true" />
    </section>
  );
}
