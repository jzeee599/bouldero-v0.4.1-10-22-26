"use client";
import { useEffect, useRef, useState } from "react";
import ColorGradePicker from "./color-grade-picker";
import { saveQuickClimb } from "@/lib/storage";
import type { Project, ClimbingSession, Attempt } from "@/lib/types";

export default function QuickLog({
  session,
  projects,
  onClose,
  onSaved,
  onOpen,
}: {
  session: ClimbingSession;
  projects: Project[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onOpen: (project: Project) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [color, setColor] = useState("");
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");
  const [purpose, setPurpose] = useState<Project["purpose"]>("project");
  const [targetId, setTargetId] = useState("new");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const dirty = Boolean(color || notes || count !== 1);
  function close() {
    if (!busy && (!dirty || window.confirm("Discard this unsaved quick log?")))
      onClose();
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const matches = projects.filter(
    (p) =>
      p.gym.trim().toLowerCase() === session.gym.trim().toLowerCase() &&
      p.name.toLowerCase() ===
        `${color.trim()} ${grade.trim()}`.toLowerCase() &&
      p.status !== "archived",
  );
  const existing = matches.find((p) => p.id === targetId);
  async function log(result: Attempt["result"]) {
    if (saving.current || !color.trim() || !grade.trim()) return;
    if (existing?.route_mode === "mapped") {
      setError(
        "Open this mapped line to choose the hold reached. Quick log creates lines without hold mapping.",
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const project =
        existing ||
        ({
          id: crypto.randomUUID(),
          name: `${color.trim()} ${grade.trim()}`,
          grade: grade.trim(),
          gym: session.gym,
          photo_url: "",
          photo_optional: true,
          status: "active",
          created_at: new Date().toISOString(),
          sent_at: null,
          holds: [],
          route_mode: "count_only",
          source_project_id: null,
          finish_type: "hold",
          notes: notes.trim(),
          purpose,
        } satisfies Project);
      const n =
        result === "sent" ? 1 : Math.min(20, Math.max(1, Math.trunc(count)));
      const now = session.ended_at ? Date.parse(session.ended_at) : Date.now();
      const batch: Attempt[] = Array.from({ length: n }, (_, i) => ({
        id: crypto.randomUUID(),
        project_id: project.id,
        session_id: session.id,
        result,
        started_hold_id: null,
        ended_hold_id: null,
        hold_result: null,
        topped_out: false,
        notes: i === n - 1 ? notes.trim() : "",
        created_at: new Date(now - n + i + 1).toISOString(),
      }));
      await saveQuickClimb(
        project,
        batch,
        result === "sent" && !session.ended_at,
        !existing,
      );
      // The write is committed; refresh failure must not invite duplicate logging.
      setColor("");
      setNotes("");
      setTargetId("new");
      setCount(1);
      setMessage(
        `${project.name}: ${result === "sent" ? "send" : `${n} attempt${n > 1 ? "s" : ""}`} saved. Choose the next line.`,
      );
      try {
        await onSaved();
      } catch {
        setError(
          "Climb saved. Close quick log and reload to refresh your library.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record this climb.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="quick-log-sheet"
      aria-labelledby="quick-log-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <h2 id="quick-log-title">Quick log</h2>
          <p>{session.gym}</p>
        </div>
        <button aria-label="Close quick log" disabled={busy} onClick={close}>
          ×
        </button>
      </header>
      <div className="quick-log-body">
        <p>Photo and hold mapping can wait. Each new line stays separate.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <ColorGradePicker
          gym={session.gym}
          color={color}
          grade={grade}
          onColor={(v) => {
            setColor(v);
            setTargetId("new");
          }}
          onGrade={(v) => {
            setGrade(v);
            setTargetId("new");
          }}
          disabled={busy}
        />
        {matches.length > 0 && (
          <fieldset disabled={busy}>
            <legend>Same color and grade already saved</legend>
            <label>
              <input
                type="radio"
                checked={targetId === "new"}
                onChange={() => setTargetId("new")}
              />
              Create a different line
            </label>
            {matches.map((p) => (
              <label key={p.id}>
                <input
                  type="radio"
                  checked={targetId === p.id}
                  onChange={() => setTargetId(p.id)}
                />
                Continue {p.name} · {p.id.slice(-4)} ·{" "}
                {p.notes || new Date(p.created_at).toLocaleDateString()}
                {p.route_mode === "mapped"
                  ? " · mapped holds (open from library)"
                  : ""}
              </label>
            ))}
          </fieldset>
        )}
        <label>
          Use
          <select
            value={purpose}
            disabled={busy || Boolean(existing)}
            onChange={(e) => setPurpose(e.target.value as Project["purpose"])}
          >
            <option value="project">Project</option>
            <option value="warm_up">Warm-up</option>
            <option value="training">Training</option>
          </select>
        </label>
        <label>
          Attempts to add
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={count}
            disabled={busy}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
        </label>
        <label>
          Notes · optional
          <textarea
            rows={2}
            maxLength={500}
            value={notes}
            disabled={busy}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      {existing?.route_mode === "mapped" && (
        <button className="button primary" onClick={() => onOpen(existing)}>
          Open mapped line
        </button>
      )}
      <footer>
        <button
          className="button primary"
          disabled={
            busy ||
            !color.trim() ||
            !grade.trim() ||
            existing?.route_mode === "mapped"
          }
          onClick={() => log("attempt")}
        >
          {busy
            ? "Saving…"
            : `Add ${count > 1 ? `${count} attempts` : "attempt"}`}
        </button>
        <button
          className="button secondary"
          disabled={
            busy ||
            !color.trim() ||
            !grade.trim() ||
            existing?.route_mode === "mapped"
          }
          onClick={() => log("sent")}
        >
          Send
        </button>
      </footer>
    </dialog>
  );
}
