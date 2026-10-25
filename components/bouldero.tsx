"use client";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import HoldMap from "./hold-map";
import QuickLog from "./quick-log";
import ColorGradePicker from "./color-grade-picker";
import GymMapView, {
  cleanedPilotGyms,
  initialGymMapViewState,
} from "./gym-map";
import SessionReportVisuals from "./session-report-visuals";
import {
  cloudEnabled,
  loadCloudPreferences,
  persistGymGradeSystem,
  deleteProject,
  deleteSession,
  endSession,
  exportLocalData,
  importLocalData,
  type ImportSummary,
  listAttempts,
  listGymMaps,
  listProjects,
  listSessions,
  saveAttempts,
  saveQuickClimb,
  saveGymMap,
  saveProject,
  startSession,
  updateProjectStatus,
  updateProjectDetails,
  updateAttemptNotes,
  updateAttemptDetails,
  updateSessionDetails,
} from "@/lib/storage";
import { preparePhoto } from "@/lib/photo";
import { reorder } from "@/lib/coordinates";
import { markerTextColor, projectMarkerColor } from "@/lib/color";
import type {
  Attempt,
  ClimbingSession,
  GymMap,
  Hold,
  Project,
} from "@/lib/types";

const sameGym = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      className="arrow-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      {back ? (
        <path d="M13 8H3m0 0 4-4M3 8l4 4" />
      ) : (
        <path d="M4 12 12 4m0 0H6m6 0v6" />
      )}
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg
      className="upload-svg"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      aria-hidden="true"
    >
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m12.5 12.5 4 4" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}
type SessionSection = "current" | "map" | "lines" | "summary";

const sessionDestinations: ReadonlyArray<{
  section: SessionSection;
  label: string;
  shortLabel: string;
}> = [
  { section: "current", label: "Current line", shortLabel: "Current" },
  { section: "map", label: "Map", shortLabel: "Map" },
  { section: "lines", label: "Session lines", shortLabel: "Lines" },
  { section: "summary", label: "Summary", shortLabel: "Summary" },
];

function SessionDestinationIcon({ section }: { section: SessionSection }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {section === "current" && (
        <>
          <circle cx="10" cy="10" r="6.5" />
          <circle cx="10" cy="10" r="2" />
        </>
      )}
      {section === "map" && (
        <>
          <path d="m3 5 4-2 6 2 4-2v12l-4 2-6-2-4 2Z" />
          <path d="M7 3v12m6-10v12" />
        </>
      )}
      {section === "lines" && (
        <>
          <path d="M6 5h11M6 10h11M6 15h11" />
          <circle cx="3" cy="5" r=".8" />
          <circle cx="3" cy="10" r=".8" />
          <circle cx="3" cy="15" r=".8" />
        </>
      )}
      {section === "summary" && (
        <>
          <path d="M3 16V9h3v7m2 0V4h4v12m2 0v-5h3v5" />
          <path d="M2 16.5h16" />
        </>
      )}
    </svg>
  );
}
function sessionDuration(startedAt: string, endedAt: string | null) {
  if (!endedAt) return "In progress";
  const minutes = Math.max(
    1,
    Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000),
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
function liveDuration(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}
function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function isToday(value: string) {
  const date = new Date(value);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}
function attemptRecency(value: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / (24 * 60));
  return days === 1 ? "Yesterday" : `${days} days ago`;
}
function BoulderArt() {
  return (
    <svg
      className="boulder-art"
      viewBox="0 0 500 400"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M51 347c70-12 116-7 176-5s147 11 220-5"
        stroke="#bec3b3"
        strokeWidth="2"
      />
      <path
        d="m82 323 28-126 99-111 118-20 84 83 25 155-68 31-221-2Z"
        fill="#dedfd2"
      />
      <path d="m110 197 99-111 31 132-93 115-65-10Z" fill="#c9cebb" />
      <path d="m209 86 118-20-35 128-52 24Z" fill="#ececdf" />
      <path d="m292 194 119-45 25 155-68 31-128-117Z" fill="#d3d7c5" />
      <path
        d="m209 86 31 132 52-24 35-128M240 218l-93 115"
        stroke="#b7beaa"
        strokeWidth="1.5"
      />
      <path d="m166 236 15-16 14 4-2 15-17 9Z" fill="#778568" />
      <path d="m208 177 12-13 12 5-4 15-15 2Z" fill="#7e8d6b" />
      <path d="m270 137 15-8 14 9-6 12-20-2Z" fill="#879671" />
      <path d="m313 97 13-5 13 10-9 10-18-3Z" fill="#6f805f" />
      <path d="m248 277 19-8 12 14-9 10-22-3Z" fill="#869873" />
      <path
        d="m273 286-48-55-1-52 58-38 42-41"
        stroke="#fbfcf4"
        strokeWidth="2"
        strokeDasharray="5 7"
      />
      <circle cx="225" cy="231" r="18" fill="#e5f7ac" />
      <text
        x="225"
        y="236"
        textAnchor="middle"
        fontSize="14"
        fontFamily="sans-serif"
        fill="#34442b"
      >
        1
      </text>
      <circle cx="225" cy="179" r="18" fill="#e5f7ac" />
      <text
        x="225"
        y="184"
        textAnchor="middle"
        fontSize="14"
        fontFamily="sans-serif"
        fill="#34442b"
      >
        2
      </text>
      <circle cx="284" cy="140" r="18" fill="#e5f7ac" />
      <text
        x="284"
        y="145"
        textAnchor="middle"
        fontSize="14"
        fontFamily="sans-serif"
        fill="#34442b"
      >
        3
      </text>
      <path
        d="m385 66 4-13m10 24 12-6m-24-24-4-11"
        stroke="#8e9d73"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Bouldero() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [screen, setScreen] = useState<
    "projects" | "new" | "project" | "start-session" | "history" | "gym-map"
  >("projects");
  const [sessionSection, setSessionSection] =
    useState<SessionSection>("current");
  const [gymMaps, setGymMaps] = useState<GymMap[]>([]);
  const [gymMapViewState, setGymMapViewState] = useState(() =>
    initialGymMapViewState(),
  );
  const [sessions, setSessions] = useState<ClimbingSession[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sessionGym, setSessionGym] = useState("");
  const [sessionGradeSystem, setSessionGradeSystem] = useState("V");
  useEffect(() => {
    const saved = localStorage.getItem(
      `bouldero-grade:${sessionGym.trim().toLowerCase()}`,
    );
    setSessionGradeSystem(saved === "Font" || saved === "Custom" ? saved : "V");
  }, [sessionGym]);
  const [sessionMode, setSessionMode] = useState<"live" | "past">("live");
  const [pastSessionStart, setPastSessionStart] = useState(() =>
    localDateTimeValue(new Date(Date.now() - 2 * 60 * 60 * 1000)),
  );
  const [pastSessionEnd, setPastSessionEnd] = useState(() =>
    localDateTimeValue(new Date()),
  );
  const [backfillSessionId, setBackfillSessionId] = useState<string | null>(
    null,
  );
  const [attemptNotes, setAttemptNotes] = useState("");
  const [attemptHoldId, setAttemptHoldId] = useState("");
  const [attemptHoldResult, setAttemptHoldResult] = useState<
    "controlled" | "touched"
  >("controlled");
  const [attemptStartMode, setAttemptStartMode] = useState<
    "ground" | "partial"
  >("ground");
  const [attemptStartHoldId, setAttemptStartHoldId] = useState("");
  const [attemptCount, setAttemptCount] = useState(1);
  const [editingAttemptId, setEditingAttemptId] = useState<string | null>(null);
  const [attemptNotesDraft, setAttemptNotesDraft] = useState("");
  const [editingAttemptDraft, setEditingAttemptDraft] =
    useState<Attempt | null>(null);
  const editingAttemptOriginalResult = useRef<Attempt["result"] | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [sessionEditGym, setSessionEditGym] = useState("");
  const [sessionEditStart, setSessionEditStart] = useState("");
  const [sessionEditEnd, setSessionEditEnd] = useState("");
  const [editingLineNotes, setEditingLineNotes] = useState(false);
  const [lineNotesDraft, setLineNotesDraft] = useState("");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter] = useState<Project["status"] | "all">(
    "all",
  );
  const [gymFilter, setGymFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Project | null>(null);
  const [projectReturnScreen, setProjectReturnScreen] = useState<
    "projects" | "history" | "gym-map"
  >("projects");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [sourceProject, setSourceProject] = useState<Project | null>(null);
  const [creationMode, setCreationMode] = useState<
    Project["route_mode"] | null
  >(null);
  const [finishType, setFinishType] = useState<Project["finish_type"]>("hold");
  const [purpose, setPurpose] = useState<Project["purpose"]>("project");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [preview, setPreview] = useState("");
  const [draftMapPosition, setDraftMapPosition] = useState<{
    gym: string;
    x: number;
    y: number;
  } | null>(null);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [selected, setSelected] = useState("");
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [mobilePage, setMobilePage] = useState<"session" | "lines">("session");
  const mobileScroll = useRef({
    session: 0,
    lines: 0,
    history: 0,
    "gym-map": 0,
  });
  const [color, setColor] = useState("");
  const [grade, setGrade] = useState("");
  const [gym, setGym] = useState("");
  const [lineNotes, setLineNotes] = useState("");
  const [wallArea, setWallArea] = useState("");
  const [error, setError] = useState("");
  const [transferProgress, setTransferProgress] = useState("");
  const [pendingImport, setPendingImport] = useState<{
    file: File;
    summary: ImportSummary;
  } | null>(null);
  const importDialog = useRef<HTMLDialogElement>(null);
  const [lastBackup, setLastBackup] = useState("");
  const [backupReminder, setBackupReminder] = useState(false);
  useEffect(() => {
    setLastBackup(localStorage.getItem("bouldero-last-backup") || "");
  }, []);
  useEffect(() => {
    if (pendingImport) importDialog.current?.showModal();
  }, [pendingImport]);
  const [busy, setBusy] = useState(false);
  const [photoPreparing, setPhotoPreparing] = useState(false);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [lastLoggedLine, setLastLoggedLine] = useState("");
  const uploading = useRef(false);
  const previewObjectUrl = useRef<string | null>(null);
  const projectsRef = useRef<Project[]>([]);
  const gymMapsRef = useRef<GymMap[]>([]);
  const projectReturnScrollY = useRef(0);
  const pendingScrollRestore = useRef<number | null>(null);
  useLayoutEffect(() => {
    const restoreY = pendingScrollRestore.current;
    pendingScrollRestore.current = null;
    window.scrollTo({ top: restoreY ?? 0, behavior: "instant" });
  }, [screen, mobilePage]);
  async function refresh() {
    if (cloudEnabled) await loadCloudPreferences();
    const [next, nextSessions, nextAttempts, nextGymMaps] = await Promise.all([
      listProjects(),
      listSessions(),
      listAttempts(),
      listGymMaps(),
    ]);
    const previousProjects = projectsRef.current;
    const previousMaps = gymMapsRef.current;
    projectsRef.current = next;
    gymMapsRef.current = nextGymMaps;
    setProjects(next);
    setSessions(nextSessions);
    setAttempts(nextAttempts);
    setGymMaps(nextGymMaps);
    window.requestAnimationFrame(() => {
      previousProjects.forEach((p) => {
        if (p.photo_url.startsWith("blob:")) URL.revokeObjectURL(p.photo_url);
      });
      previousMaps.forEach((map) => {
        if (map.image_url.startsWith("blob:"))
          URL.revokeObjectURL(map.image_url);
      });
    });
    return next;
  }
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      projectsRef.current.forEach((p) => {
        if (p.photo_url.startsWith("blob:")) URL.revokeObjectURL(p.photo_url);
      });
      gymMapsRef.current.forEach((map) => {
        if (map.image_url.startsWith("blob:"))
          URL.revokeObjectURL(map.image_url);
      });
    };
  }, []);
  useEffect(() => {
    if (!cloudEnabled) return;
    let cancelled = false;
    let running = false;
    const sync = async () => {
      if (
        running ||
        busy ||
        document.visibilityState !== "visible" ||
        !["projects", "history", "gym-map"].includes(screen)
      )
        return;
      running = true;
      try {
        await refresh();
        if (!cancelled) setError("");
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Could not refresh cloud data. Your data has not been removed.",
          );
      } finally {
        running = false;
      }
    };
    const onFocus = () => {
      void sync();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(onFocus, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [busy, screen]);
  useEffect(
    () => () => {
      if (previewObjectUrl.current)
        URL.revokeObjectURL(previewObjectUrl.current);
    },
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setAttemptNotes("");
    setAttemptHoldId("");
    setAttemptHoldResult("controlled");
    setAttemptStartMode("ground");
    setAttemptStartHoldId("");
    setAttemptCount(1);
    setEditingAttemptId(null);
    setEditingAttemptDraft(null);
    editingAttemptOriginalResult.current = null;
    setAttemptNotesDraft("");
    setEditingLineNotes(false);
    setLineNotesDraft(opened?.notes || "");
  }, [opened?.id]);
  const originalAttempt = attempts.find((item) => item.id === editingAttemptId);
  const originalSession = sessions.find((item) => item.id === editingSessionId);
  const newLineDirty =
    screen === "new" &&
    (editingProject
      ? photoChanged ||
        `${color.trim()} ${grade.trim()}` !== editingProject.name ||
        gym !== editingProject.gym ||
        lineNotes !== editingProject.notes ||
        wallArea !== (editingProject.wall_area || "") ||
        creationMode !== editingProject.route_mode ||
        purpose !== editingProject.purpose ||
        finishType !== editingProject.finish_type ||
        JSON.stringify(holds) !== JSON.stringify(editingProject.holds)
      : Boolean(
          photo ||
          sourceProject ||
          color ||
          grade ||
          lineNotes ||
          wallArea ||
          holds.length ||
          creationMode,
        ));
  const originalEditedAttempt = attempts.find(
    (item) => item.id === editingAttemptDraft?.id,
  );
  const editedAttemptDirty = Boolean(
    editingAttemptDraft &&
    originalEditedAttempt &&
    JSON.stringify(editingAttemptDraft) !==
      JSON.stringify({
        ...originalEditedAttempt,
        created_at: localDateTimeValue(
          new Date(originalEditedAttempt.created_at),
        ),
      }),
  );
  const hasUnsaved = Boolean(
    newLineDirty ||
    (screen === "project" &&
      (attemptNotes ||
        attemptHoldId ||
        attemptStartMode !== "ground" ||
        attemptCount !== 1 ||
        (editingLineNotes && lineNotesDraft !== (opened?.notes || "")) ||
        (editingAttemptId && attemptNotesDraft !== originalAttempt?.notes) ||
        editedAttemptDirty)) ||
    (originalSession &&
      (sessionEditGym !== originalSession.gym ||
        sessionEditStart !==
          localDateTimeValue(new Date(originalSession.started_at)) ||
        (originalSession.ended_at &&
          sessionEditEnd !==
            localDateTimeValue(new Date(originalSession.ended_at))))),
  );
  function confirmLeave() {
    return (
      !hasUnsaved ||
      window.confirm("Discard unsaved changes? Your saved climbs will stay.")
    );
  }
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);
  function start() {
    if (!confirmLeave()) return;
    projectReturnScrollY.current = window.scrollY;
    setProjectReturnScreen("projects");
    setColor("");
    setGrade("");
    setLineNotes("");
    setWallArea("");
    setGym(loggingSession?.gym || "");
    setHolds([]);
    setSelected("");
    setPhoto(null);
    setPhotoChanged(false);
    setSourceProject(null);
    setCreationMode(null);
    setFinishType("hold");
    setPurpose("project");
    setEditingProject(null);
    setPreview("");
    setDraftMapPosition(null);
    setError("");
    setScreen("new");
  }
  function startFromMap(gymName: string, x: number, y: number) {
    start();
    setGym(gymName);
    setDraftMapPosition({ gym: gymName, x, y });
    setProjectReturnScreen("gym-map");
  }
  function reusePhoto(project: Project) {
    if (screen !== "new" && !confirmLeave()) return;
    if (editingProject) {
      setPhoto(null);
      setPhotoChanged(true);
      setSourceProject(project);
      setPreview(project.photo_optional ? "" : project.photo_url);
      setHolds([]);
      setSelected("");
      setCreationMode(editingProject.route_mode);
      setError("");
      return;
    }
    setColor("");
    setGrade("");
    setLineNotes("");
    setWallArea("");
    setGym(loggingSession?.gym || project.gym);
    setHolds([]);
    setSelected("");
    setPhoto(null);
    setPhotoChanged(false);
    setSourceProject(project);
    setCreationMode(null);
    setFinishType("hold");
    setPurpose("project");
    setEditingProject(null);
    setPreview(project.photo_url);
    setError("");
    setScreen("new");
  }
  const activeSession = sessions.find((session) => !session.ended_at) || null;
  const backfillSession =
    sessions.find((session) => session.id === backfillSessionId) || null;
  const loggingSession = backfillSession || activeSession;
  const previousLoggingSessionId = useRef<string | null>(null);
  useEffect(() => {
    const nextId = loggingSession?.id || null;
    if (nextId !== previousLoggingSessionId.current) {
      previousLoggingSessionId.current = nextId;
      setSessionSection("current");
    }
  }, [loggingSession?.id]);
  useEffect(() => {
    if (!activeSession) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeSession?.id]);
  const knownGyms = Array.from(
    new Map(
      [
        ...projects.map((project) => project.gym),
        ...gymMaps.map((map) => map.gym),
        ...cleanedPilotGyms,
      ]
        .map((gymName) => gymName.trim())
        .filter(Boolean)
        .map((gymName) => [gymName.toLocaleLowerCase(), gymName] as const),
    ).values(),
  ).sort((a, b) => a.localeCompare(b));
  const draftGymMap = gymMaps.find(
    (map) =>
      map.gym.trim().toLocaleLowerCase() === gym.trim().toLocaleLowerCase(),
  );
  async function beginSession(event: React.FormEvent) {
    event.preventDefault();
    if (!sessionGym.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      let timing: { startedAt: string; endedAt: string } | undefined;
      if (sessionMode === "past") {
        const startedAt = new Date(pastSessionStart);
        const endedAt = new Date(pastSessionEnd);
        if (
          !pastSessionStart ||
          !pastSessionEnd ||
          Number.isNaN(startedAt.getTime()) ||
          Number.isNaN(endedAt.getTime()) ||
          endedAt <= startedAt
        ) {
          setError("Choose an end time after the session start time.");
          return;
        }
        timing = {
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        };
      }
      const session = await startSession(sessionGym, timing);
      setSessions((current) =>
        [session, ...current].sort((a, b) =>
          b.started_at.localeCompare(a.started_at),
        ),
      );
      setBackfillSessionId(sessionMode === "past" ? session.id : null);
      setMobilePage("session");
      setScreen("projects");
      setNotice(
        sessionMode === "past"
          ? `Past session created. Add the lines and attempts you remember.`
          : `Session started at ${session.gym}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start session.");
    } finally {
      setBusy(false);
    }
  }
  function finishBackfill() {
    setBackfillSessionId(null);
    setScreen("history");
    setNotice("Past session saved to your history.");
  }
  async function removeSession(session: ClimbingSession) {
    if (
      busy ||
      !window.confirm(
        `Delete the ${new Date(session.started_at).toLocaleDateString()} session at ${session.gym}? Its attempts will be deleted, but your saved lines will stay.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deleteSession(session.id);
      setSessions((current) =>
        current.filter((item) => item.id !== session.id),
      );
      setAttempts((current) =>
        current.filter((attempt) => attempt.session_id !== session.id),
      );
      if (backfillSessionId === session.id) setBackfillSessionId(null);
      setNotice("Session deleted. Its saved lines are unchanged.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete session.");
    } finally {
      setBusy(false);
    }
  }
  async function shareSessionReport(session: ClimbingSession) {
    const sessionAttempts = attempts.filter(
      (attempt) => attempt.session_id === session.id,
    );
    const lineCount = new Set(
      sessionAttempts.map((attempt) => attempt.project_id),
    ).size;
    const sendCount = sessionAttempts.filter(isPerformanceSend).length;
    const controlledHolds = sessionAttempts.reduce((total, attempt) => {
      const project = projects.find((item) => item.id === attempt.project_id);
      if (!project || project.route_mode !== "mapped") return total;
      if (attempt.topped_out) return total + project.holds.length;
      const end = project.holds.find(
        (hold) => hold.id === attempt.ended_hold_id,
      )?.order_index;
      const start = project.holds.find(
        (hold) => hold.id === attempt.started_hold_id,
      )?.order_index;
      const controlledEnd =
        attempt.hold_result === "touched" && end ? end - 1 : end;
      return controlledEnd
        ? total + Math.max(0, controlledEnd - (start || 1) + 1)
        : total;
    }, 0);
    const date = new Date(session.started_at).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.fillStyle = "#f6f5ea";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#20241d";
      context.font = "700 42px sans-serif";
      context.fillText("b · bouldero.", 72, 90);
      context.fillStyle = "#75806b";
      context.font = "600 22px sans-serif";
      context.fillText("SESSION FIELD NOTES", 72, 160);
      context.fillStyle = "#20241d";
      context.font = "700 78px sans-serif";
      const gymName =
        context.measureText(session.gym).width > 900
          ? `${session.gym.slice(0, 20)}…`
          : session.gym;
      context.fillText(gymName, 72, 265);
      context.fillStyle = "#75806b";
      context.font = "400 30px sans-serif";
      context.fillText(date, 72, 315);
      context.fillStyle = "#d8ff62";
      context.beginPath();
      context.roundRect(72, 380, 936, 360, 28);
      context.fill();
      const metrics = [
        ["TIME", sessionDuration(session.started_at, session.ended_at)],
        ["LINES", String(lineCount)],
        ["ATTEMPTS", String(sessionAttempts.length)],
        ["SENDS", String(sendCount)],
        ["HOLDS CONTROLLED", controlledHolds ? String(controlledHolds) : "—"],
      ];
      metrics.forEach(([label, value], index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const x = 112 + column * 300;
        const y = 455 + row * 145;
        context.fillStyle = "#536046";
        context.font = "600 18px sans-serif";
        context.fillText(label, x, y);
        context.fillStyle = "#20241d";
        context.font = "700 46px sans-serif";
        context.fillText(value, x, y + 58);
      });
      context.fillStyle = "#20241d";
      context.font = "700 24px sans-serif";
      context.fillText("SESSION HIGHLIGHTS", 72, 825);
      const highlights = [
        sendCount
          ? `${sendCount} project${sendCount === 1 ? "" : "s"} sent`
          : "Kept showing up",
        `${sessionAttempts.length} tries recorded`,
        controlledHolds
          ? `${controlledHolds} holds controlled`
          : `${lineCount} lines explored`,
      ];
      highlights.forEach((highlight, index) => {
        const y = 885 + index * 82;
        context.fillStyle = "#e6e9dc";
        context.beginPath();
        context.roundRect(72, y - 42, 936, 62, 31);
        context.fill();
        context.fillStyle = "#394133";
        context.font = "600 25px sans-serif";
        context.fillText(highlight, 102, y);
      });
      context.strokeStyle = "#cfd4c4";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(72, 1180);
      context.lineTo(1008, 1180);
      context.stroke();
      context.fillStyle = "#75806b";
      context.font = "400 24px sans-serif";
      context.fillText("ONE HOLD AT A TIME", 72, 1245);
      context.fillStyle = "#20241d";
      context.font = "600 24px sans-serif";
      context.textAlign = "right";
      context.fillText("Recorded with Bouldero", 1008, 1245);
      context.textAlign = "left";
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("Image failed.")),
          "image/png",
        ),
      );
      const file = new File([blob], `bouldero-${session.id}.png`, {
        type: "image/png",
      });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "My Bouldero session",
          text: `${session.gym} · ${date}`,
          files: [file],
        });
        setNotice("Session image card shared.");
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        setNotice("Session image card downloaded.");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError("Could not create this session image card.");
    }
  }
  async function finishSession() {
    if (!activeSession || busy || !confirmLeave()) return;
    setBusy(true);
    setError("");
    try {
      const ended = await endSession(activeSession);
      setSessions((current) =>
        current.map((session) => (session.id === ended.id ? ended : session)),
      );
      setNotice("Session saved. Nice work today.");
      setBackupReminder(true);
      setAttemptNotes("");
      setAttemptHoldId("");
      setAttemptCount(1);
      setAttemptStartMode("ground");
      setEditingLineNotes(false);
      setEditingAttemptId(null);
      setEditingAttemptDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end session.");
    } finally {
      setBusy(false);
    }
  }
  async function recordAttempt(
    result: Attempt["result"],
    options: { directSend?: boolean } = {},
  ) {
    if (!loggingSession || !opened || busy) return;
    if (
      opened.gym.trim().toLocaleLowerCase() !==
      loggingSession.gym.trim().toLocaleLowerCase()
    ) {
      setError(
        `This session is at ${loggingSession.gym}. You can edit this line, but attempts must be logged in a session at ${opened.gym || "its gym"}.`,
      );
      return;
    }
    const startMode = options.directSend ? "ground" : attemptStartMode;
    const endedHoldId =
      opened.route_mode === "mapped"
        ? result === "sent" && opened.finish_type === "hold"
          ? opened.holds.at(-1)?.id || ""
          : attemptHoldId
        : "";
    const toppedOut =
      opened.route_mode === "mapped" &&
      opened.finish_type === "top_out" &&
      result === "sent";
    const startedHoldId =
      opened.route_mode === "mapped" && startMode === "partial"
        ? attemptStartHoldId
        : "";
    if (
      opened.route_mode === "mapped" &&
      startMode === "partial" &&
      !startedHoldId
    ) {
      setError("Choose the hold where this partial start began.");
      return;
    }
    if (
      opened.route_mode === "mapped" &&
      startMode === "partial" &&
      !endedHoldId &&
      !toppedOut
    ) {
      setError("Choose the last hold you controlled after the partial start.");
      return;
    }
    const startIndex =
      opened.holds.find((hold) => hold.id === startedHoldId)?.order_index || 0;
    const endIndex =
      opened.holds.find((hold) => hold.id === endedHoldId)?.order_index || 0;
    if (startIndex && endIndex && endIndex < startIndex) {
      setError(
        "The controlled hold cannot come before the partial starting hold.",
      );
      return;
    }
    const count =
      result === "sent" ? 1 : Math.min(20, Math.max(1, attemptCount));
    const now = backfillSession?.ended_at
      ? Date.parse(backfillSession.ended_at)
      : Date.now();
    const batch: Attempt[] = Array.from({ length: count }, (_, index) => ({
      id: crypto.randomUUID(),
      project_id: opened.id,
      session_id: loggingSession.id,
      result,
      started_hold_id: startedHoldId || null,
      ended_hold_id: endedHoldId || null,
      hold_result: endedHoldId
        ? result === "sent"
          ? "controlled"
          : attemptHoldResult
        : null,
      topped_out: toppedOut,
      notes: index === count - 1 ? attemptNotes.trim() : "",
      created_at: new Date(now - (count - 1 - index)).toISOString(),
    }));
    setBusy(true);
    setError("");
    try {
      await saveQuickClimb(
        opened,
        batch,
        result === "sent" && !backfillSession,
        false,
      );
      setAttempts((current) => [...[...batch].reverse(), ...current]);
      setLastLoggedLine(opened.id);
      if (result === "sent" && !backfillSession) {
        const updated: Project = {
          ...opened,
          status: "sent",
          sent_at: opened.sent_at || batch.at(-1)!.created_at,
        };
        setOpened(updated);
        setProjects((current) =>
          current.map((project) =>
            project.id === updated.id ? updated : project,
          ),
        );
      }
      setAttemptNotes("");
      setAttemptHoldId("");
      setAttemptHoldResult("controlled");
      setAttemptStartMode("ground");
      setAttemptStartHoldId("");
      setAttemptCount(1);
      setNotice(
        result === "sent"
          ? backfillSession
            ? "Past send recorded. The line’s current status is unchanged."
            : opened.purpose === "project"
              ? "Send recorded. Line completed."
              : "Send recorded. Line completed and available to reuse."
          : count === 1
            ? "Attempt recorded."
            : `${count} attempts recorded.`,
      );
      if (
        result === "sent" &&
        opened.purpose !== "project" &&
        !backfillSession
      ) {
        pendingScrollRestore.current = projectReturnScrollY.current;
        setScreen(projectReturnScreen);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save attempt.");
    } finally {
      setBusy(false);
    }
  }
  async function addAttempt(event: React.FormEvent) {
    event.preventDefault();
    await recordAttempt("attempt");
  }
  async function changeProjectStatus(status: Project["status"]) {
    if (!opened || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await updateProjectStatus(opened, status);
      setOpened(updated);
      setProjects((current) =>
        current.map((project) =>
          project.id === updated.id ? updated : project,
        ),
      );
      const label =
        status === "active"
          ? "Ongoing"
          : status === "sent"
            ? "Completed"
            : "Archived";
      setNotice(`Line moved to ${label}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update line.");
    } finally {
      setBusy(false);
    }
  }
  async function removeProject(project: Project) {
    if (
      busy ||
      !window.confirm(
        `Permanently delete ${project.name}? All attempts for this line and its gym-map marker will also be deleted. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deleteProject(project.id);
      setProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );
      setAttempts((current) =>
        current.filter((attempt) => attempt.project_id !== project.id),
      );
      setGymMaps((current) =>
        current.map((map) => ({
          ...map,
          markers: map.markers.filter(
            (marker) => marker.project_id !== project.id,
          ),
        })),
      );
      setOpened(null);
      setEditingProject(null);
      pendingScrollRestore.current = projectReturnScrollY.current;
      setScreen(projectReturnScreen === "gym-map" ? "gym-map" : "projects");
      setNotice(`${project.name} was permanently deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete line.");
    } finally {
      setBusy(false);
    }
  }
  async function saveInlineLineNotes() {
    if (!opened || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = { ...opened, notes: lineNotesDraft.trim() };
      await updateProjectDetails(updated);
      setOpened(updated);
      setProjects((current) =>
        current.map((project) =>
          project.id === updated.id ? updated : project,
        ),
      );
      setEditingLineNotes(false);
      setNotice("Line notes updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update line notes.");
    } finally {
      setBusy(false);
    }
  }
  async function saveAttemptNote(attempt: Attempt) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await updateAttemptNotes(attempt, attemptNotesDraft);
      setAttempts((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingAttemptId(null);
      setAttemptNotesDraft("");
      setNotice("Attempt note updated.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update attempt note.",
      );
    } finally {
      setBusy(false);
    }
  }
  function beginSessionDetailsEdit(session: ClimbingSession) {
    setEditingSessionId(session.id);
    setSessionEditGym(session.gym);
    setSessionEditStart(localDateTimeValue(new Date(session.started_at)));
    setSessionEditEnd(
      session.ended_at ? localDateTimeValue(new Date(session.ended_at)) : "",
    );
  }
  async function saveSessionDetails(session: ClimbingSession) {
    const startedAt = new Date(sessionEditStart);
    const endedAt = session.ended_at ? new Date(sessionEditEnd) : null;
    if (
      busy ||
      !sessionEditGym.trim() ||
      Number.isNaN(startedAt.getTime()) ||
      (endedAt && (Number.isNaN(endedAt.getTime()) || endedAt <= startedAt))
    ) {
      setError(
        session.ended_at
          ? "Choose a gym and an end time after the session start time."
          : "Choose a gym and a valid session start time.",
      );
      return;
    }
    const sessionAttempts = attempts.filter(
      (attempt) => attempt.session_id === session.id,
    );
    const attemptOutsideEditedRange = sessionAttempts.some((attempt) => {
      const attemptTime = Date.parse(attempt.created_at);
      return (
        attemptTime < startedAt.getTime() - 60_000 ||
        (endedAt && attemptTime > endedAt.getTime() + 60_000)
      );
    });
    if (attemptOutsideEditedRange) {
      setError(
        "Session times must include every attempt already logged in this session.",
      );
      return;
    }
    if (
      activeSession &&
      activeSession.id !== session.id &&
      endedAt &&
      endedAt.getTime() > Date.parse(activeSession.started_at)
    ) {
      setError("This session must end before your current session begins.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await updateSessionDetails({
        ...session,
        gym: sessionEditGym,
        started_at: startedAt.toISOString(),
        ended_at: endedAt?.toISOString() || null,
      });
      setSessions((current) =>
        current
          .map((item) => (item.id === updated.id ? updated : item))
          .sort((a, b) => b.started_at.localeCompare(a.started_at)),
      );
      setEditingSessionId(null);
      setNotice("Session details updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update session.");
    } finally {
      setBusy(false);
    }
  }
  async function saveAttemptEdit(project: Project) {
    if (!editingAttemptDraft || busy) return;
    const when = new Date(editingAttemptDraft.created_at);
    const originalAttempt = attempts.find(
      (attempt) => attempt.id === editingAttemptDraft.id,
    );
    const owningSession = sessions.find(
      (session) => session.id === editingAttemptDraft.session_id,
    );
    if (Number.isNaN(when.getTime())) {
      setError("Choose a valid attempt time.");
      return;
    }
    if (
      owningSession &&
      (when.getTime() < Date.parse(owningSession.started_at) - 60_000 ||
        (owningSession.ended_at &&
          when.getTime() > Date.parse(owningSession.ended_at) + 60_000))
    ) {
      setError("Attempt time must fall inside its session.");
      return;
    }
    const lastHold = project.holds[project.holds.length - 1];
    const updated: Attempt = {
      ...editingAttemptDraft,
      started_hold_id: editingAttemptDraft.started_hold_id || null,
      ended_hold_id:
        editingAttemptDraft.result === "sent" && project.finish_type === "hold"
          ? lastHold?.id || null
          : editingAttemptDraft.ended_hold_id || null,
      hold_result:
        editingAttemptDraft.result === "sent" && project.finish_type === "hold"
          ? "controlled"
          : editingAttemptDraft.ended_hold_id
            ? editingAttemptDraft.hold_result || "controlled"
            : null,
      topped_out:
        editingAttemptDraft.result === "sent" &&
        project.finish_type === "top_out",
      created_at: when.toISOString(),
    };
    const startIndex =
      project.holds.find((hold) => hold.id === updated.started_hold_id)
        ?.order_index || 0;
    const endIndex =
      project.holds.find((hold) => hold.id === updated.ended_hold_id)
        ?.order_index || 0;
    if (startIndex && endIndex && endIndex < startIndex) {
      setError("The controlled hold cannot come before the starting hold.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await updateAttemptDetails(updated);
      const nextAttempts = attempts
        .map((attempt) => (attempt.id === saved.id ? saved : attempt))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      setAttempts(nextAttempts);
      if (editingAttemptOriginalResult.current) {
        const isLiveSession = Boolean(owningSession && !owningSession.ended_at);
        const anotherSendInSession = nextAttempts.some(
          (attempt) =>
            attempt.id !== saved.id &&
            attempt.session_id === saved.session_id &&
            attempt.project_id === project.id &&
            attempt.result === "sent",
        );
        const newerSendExists = nextAttempts.some(
          (attempt) =>
            attempt.id !== saved.id &&
            attempt.project_id === project.id &&
            attempt.result === "sent" &&
            Date.parse(attempt.created_at) >
              Date.parse(originalAttempt?.created_at || saved.created_at),
        );
        const nextStatus =
          editingAttemptOriginalResult.current === "attempt" &&
          saved.result === "sent" &&
          isLiveSession
            ? "sent"
            : editingAttemptOriginalResult.current === "sent" &&
                saved.result === "attempt" &&
                !anotherSendInSession &&
                !newerSendExists
              ? "active"
              : null;
        if (nextStatus) {
          const updatedProject = await updateProjectStatus(project, nextStatus);
          setOpened(updatedProject);
          setProjects((current) =>
            current.map((item) =>
              item.id === updatedProject.id ? updatedProject : item,
            ),
          );
        }
      }
      setEditingAttemptDraft(null);
      editingAttemptOriginalResult.current = null;
      setNotice("Attempt details updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update attempt.");
    } finally {
      setBusy(false);
    }
  }
  function back() {
    if (busy) return;
    if (!confirmLeave()) return;
    setError("");
    setAttemptNotes("");
    setAttemptHoldId("");
    setAttemptCount(1);
    setAttemptStartMode("ground");
    setEditingLineNotes(false);
    setEditingAttemptId(null);
    setEditingAttemptDraft(null);
    setEditingSessionId(null);
    if (screen === "project") {
      pendingScrollRestore.current = projectReturnScrollY.current;
      setScreen(projectReturnScreen);
    } else if (screen === "new" && editingProject && opened)
      setScreen("project");
    else setScreen("projects");
    setPhoto(null);
    setPhotoChanged(false);
    setSourceProject(null);
    setCreationMode(null);
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
    setPreview("");
    setDraftMapPosition(null);
    setEditingProject(null);
  }
  function editProject(project: Project) {
    if (!confirmLeave()) return;
    setEditingProject(project);
    setColor(
      project.name
        .slice(0, Math.max(0, project.name.length - project.grade.length))
        .trim(),
    );
    setGrade(project.grade);
    setGym(project.gym);
    setLineNotes(project.notes);
    setWallArea(project.wall_area || "");
    setHolds(project.holds.map((hold) => ({ ...hold })));
    setSelected("");
    setPhoto(null);
    setPhotoChanged(false);
    setSourceProject(
      project.photo_optional
        ? null
        : project.source_project_id
          ? projects.find((item) => item.id === project.source_project_id) ||
            project
          : project,
    );
    setCreationMode(project.route_mode);
    setFinishType(project.finish_type);
    setPurpose(project.purpose);
    setPreview(project.photo_url);
    setDraftMapPosition(null);
    setError("");
    setScreen("new");
  }
  async function choose(file?: File) {
    if (!file || uploading.current) return;
    uploading.current = true;
    setBusy(true);
    setPhotoPreparing(true);
    setError("");
    try {
      const blob = await preparePhoto(file);
      if (previewObjectUrl.current)
        URL.revokeObjectURL(previewObjectUrl.current);
      const objectUrl = URL.createObjectURL(blob);
      previewObjectUrl.current = objectUrl;
      setPhoto(blob);
      setPhotoChanged(true);
      setSourceProject(null);
      setCreationMode(null);
      setPreview(objectUrl);
      setHolds([]);
      setSelected("");
      setNotice("Photo ready. Choose how you want to track this line.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open photo.");
    } finally {
      setBusy(false);
      setPhotoPreparing(false);
      uploading.current = false;
    }
  }
  function removeSelectedPhoto() {
    if (busy) return;
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
    setPhoto(null);
    setPhotoChanged(true);
    setSourceProject(null);
    setPreview("");
    setCreationMode(null);
    setHolds([]);
    setSelected("");
    setDraftMapPosition(null);
    setNotice("Photo removed from this draft. Choose another to continue.");
  }
  async function save() {
    if (
      (creationMode === "mapped" && !photo && !sourceProject) ||
      !creationMode ||
      !color.trim() ||
      !grade.trim() ||
      (creationMode === "mapped" && !holds.length) ||
      busy
    )
      return;
    setBusy(true);
    setError("");
    const project: Project = {
      ...(editingProject || ({} as Project)),
      id: editingProject?.id || crypto.randomUUID(),
      name: `${color.trim()} ${grade.trim()}`,
      grade: grade.trim(),
      gym: gym.trim(),
      photo_url: "",
      photo_optional: !photo && !sourceProject,
      status: editingProject?.status || "active",
      created_at: editingProject?.created_at || new Date().toISOString(),
      sent_at: editingProject?.sent_at || null,
      holds:
        creationMode === "mapped"
          ? holds.map((hold, index) => ({
              ...hold,
              is_top: finishType === "hold" && index === holds.length - 1,
            }))
          : holds,
      route_mode: creationMode,
      source_project_id: photo
        ? null
        : sourceProject?.id === editingProject?.id
          ? editingProject?.source_project_id || null
          : sourceProject?.source_project_id || sourceProject?.id || null,
      finish_type: creationMode === "mapped" ? finishType : "hold",
      notes: lineNotes.trim(),
      wall_area: wallArea.trim(),
      purpose,
    };
    try {
      if (editingProject)
        await updateProjectDetails(project, photoChanged ? photo : undefined);
      else await saveProject(project, photo);
      if (!editingProject && draftMapPosition) {
        const targetMap = gymMaps.find(
          (item) =>
            item.gym.trim().toLocaleLowerCase() ===
            draftMapPosition.gym.trim().toLocaleLowerCase(),
        );
        if (targetMap) {
          await saveGymMap({
            ...targetMap,
            markers: [
              ...targetMap.markers.filter(
                (marker) => marker.project_id !== project.id,
              ),
              {
                project_id: project.id,
                x: draftMapPosition.x,
                y: draftMapPosition.y,
              },
            ],
            updated_at: new Date().toISOString(),
          });
        }
      }
      // Do not invite a duplicate save if reloading the list fails after commit.
      setScreen("projects");
      setPhoto(null);
      setPhotoChanged(false);
      setSourceProject(null);
      setCreationMode(null);
      if (previewObjectUrl.current) {
        URL.revokeObjectURL(previewObjectUrl.current);
        previewObjectUrl.current = null;
      }
      setPreview("");
      setDraftMapPosition(null);
      setEditingProject(null);
      setNotice(
        editingProject
          ? "Line details and holds updated."
          : draftMapPosition
            ? "Line saved and placed on the gym map."
            : "Line saved. Your next climb starts here.",
      );
      const next = await refresh();
      if (projectReturnScreen !== "gym-map") projectReturnScrollY.current = 0;
      setOpened(next.find((p) => p.id === project.id)!);
      setScreen("project");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save the line. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function downloadBackup() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const blob = await exportLocalData();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bouldero-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      const timestamp = new Date().toISOString();
      localStorage.setItem("bouldero-last-backup", timestamp);
      setLastBackup(timestamp);
      setBackupReminder(false);
      setNotice(
        "Backup download requested. Keep the JSON file in a safe place.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export your data.");
    } finally {
      setBusy(false);
    }
  }
  async function restoreBackup(file?: File, confirmed = false) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      setTransferProgress("Checking backup…");
      if (!confirmed) {
        const summary = await importLocalData(file, undefined, true);
        setPendingImport({ file, summary });
        return;
      }
      const summary = await importLocalData(file, setTransferProgress);
      await refresh();
      setPendingImport(null);
      setNotice(
        `Imported ${summary.projects} lines, ${summary.sessions} sessions, and ${summary.attempts} attempts. ${summary.gym_maps} gym maps included.`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not import this backup.",
      );
    } finally {
      setTransferProgress("");
      setBusy(false);
    }
  }
  const searchNeedle = query.trim().toLocaleLowerCase();
  const gymScopedProjects = projects.filter(
    (project) => gymFilter === "all" || sameGym(project.gym, gymFilter),
  );
  const searchedProjects = gymScopedProjects.filter(
    (project) =>
      !searchNeedle ||
      [project.name, project.grade, project.gym, project.notes]
        .join(" ")
        .toLocaleLowerCase()
        .includes(searchNeedle),
  );
  const statusCounts = {
    active: gymScopedProjects.filter((project) => project.status === "active")
      .length,
    sent: gymScopedProjects.filter((project) => project.status === "sent")
      .length,
    archived: gymScopedProjects.filter(
      (project) => project.status === "archived",
    ).length,
  };
  const loggingAttemptProjectIds = new Set(
    attempts
      .filter((attempt) => attempt.session_id === loggingSession?.id)
      .map((attempt) => attempt.project_id),
  );
  const lastAttemptAt = (projectId: string) =>
    attempts.find((attempt) => attempt.project_id === projectId)?.created_at ||
    "";
  const visibleProjects = searchedProjects
    .filter(
      (project) => statusFilter === "all" || project.status === statusFilter,
    )
    .sort((a, b) => {
      if (!loggingSession || gymFilter !== "all")
        return b.created_at.localeCompare(a.created_at);
      const aHere = sameGym(a.gym, loggingSession.gym) ? 1 : 0;
      const bHere = sameGym(b.gym, loggingSession.gym) ? 1 : 0;
      const aAttempted = loggingAttemptProjectIds.has(a.id) ? 1 : 0;
      const bAttempted = loggingAttemptProjectIds.has(b.id) ? 1 : 0;
      return (
        bHere - aHere ||
        bAttempted - aAttempted ||
        lastAttemptAt(b.id).localeCompare(lastAttemptAt(a.id)) ||
        b.created_at.localeCompare(a.created_at)
      );
    });
  const openedAttempts = opened
    ? attempts.filter((attempt) => attempt.project_id === opened.id)
    : [];
  const openedMatchesLoggingGym = Boolean(
    opened && loggingSession && sameGym(opened.gym, loggingSession.gym),
  );
  const sessionHistory = sessions.map((session) => ({
    ...session,
    attempts: attempts.filter((attempt) => attempt.session_id === session.id),
  }));
  const isPerformanceSend = (attempt: Attempt) =>
    attempt.result === "sent" &&
    projects.find((project) => project.id === attempt.project_id)?.purpose !==
      "warm_up";
  const totalSends = attempts.filter(isPerformanceSend).length;
  const activeSessionAttempts = loggingSession
    ? attempts.filter((attempt) => attempt.session_id === loggingSession.id)
    : [];
  const sessionAttemptedProjects = Array.from(
    new Set(activeSessionAttempts.map((attempt) => attempt.project_id)),
  )
    .map((projectId) => projects.find((project) => project.id === projectId))
    .filter((project): project is Project => Boolean(project))
    .sort((a, b) => {
      const aLatest = activeSessionAttempts.find(
        (attempt) => attempt.project_id === a.id,
      )?.created_at;
      const bLatest = activeSessionAttempts.find(
        (attempt) => attempt.project_id === b.id,
      )?.created_at;
      return (bLatest || "").localeCompare(aLatest || "");
    });
  const sessionAttemptedProjectIds = new Set(
    sessionAttemptedProjects.map((project) => project.id),
  );
  const sessionAvailableProjects = loggingSession
    ? projects.filter(
        (project) =>
          sameGym(project.gym, loggingSession.gym) &&
          !sessionAttemptedProjectIds.has(project.id) &&
          (backfillSession
            ? project.status !== "archived"
            : project.status === "active" ||
              (project.status === "sent" && project.purpose !== "project")),
      )
    : [];
  const sessionRecentProjects = sessionAvailableProjects
    .filter((project) =>
      attempts.some((attempt) => attempt.project_id === project.id),
    )
    .sort((a, b) => lastAttemptAt(b.id).localeCompare(lastAttemptAt(a.id)));
  const sessionUntriedProjects = sessionAvailableProjects
    .filter(
      (project) =>
        !attempts.some((attempt) => attempt.project_id === project.id),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const sessionNewLines = loggingSession
    ? projects.filter(
        (project) =>
          sameGym(project.gym, loggingSession.gym) &&
          Date.parse(project.created_at) >=
            Date.parse(loggingSession.started_at),
      )
    : [];
  const sessionCarriedLines = loggingSession
    ? projects.filter(
        (project) =>
          sameGym(project.gym, loggingSession.gym) &&
          Date.parse(project.created_at) <
            Date.parse(loggingSession.started_at) &&
          (project.status === "active" ||
            Boolean(
              project.sent_at &&
              Date.parse(project.sent_at) >=
                Date.parse(loggingSession.started_at),
            )),
      )
    : [];
  const switchableLines = loggingSession
    ? projects
        .filter(
          (project) =>
            project.id !== opened?.id &&
            (Boolean(backfillSession) ||
              project.status === "active" ||
              (project.status === "sent" && project.purpose !== "project")) &&
            project.status !== "archived" &&
            sameGym(project.gym, loggingSession.gym),
        )
        .sort((a, b) => {
          const sameArea = (p: Project) =>
            Boolean(
              opened?.wall_area?.trim() &&
              p.wall_area?.trim().toLowerCase() ===
                opened.wall_area.trim().toLowerCase(),
            );
          return (
            Number(sameArea(b)) - Number(sameArea(a)) ||
            Date.parse(b.created_at) - Date.parse(a.created_at)
          );
        })
    : [];
  const activeGymMap = loggingSession
    ? gymMaps.find((map) => sameGym(map.gym, loggingSession.gym))
    : null;
  const activeGymMapMarkers = activeGymMap
    ? activeGymMap.markers.filter(
        (marker) =>
          projects.find((project) => project.id === marker.project_id)
            ?.status !== "archived",
      )
    : [];
  const latestSessionAttempt = [...activeSessionAttempts].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
  const currentSessionProject = projects.find(
    (project) => project.id === latestSessionAttempt?.project_id,
  );
  const latestMapMarker = activeGymMapMarkers.find(
    (marker) => marker.project_id === latestSessionAttempt?.project_id,
  );
  const mappedSessionLines = activeGymMap
    ? activeGymMapMarkers
        .map((marker) => ({
          marker,
          project: projects.find((project) => project.id === marker.project_id),
          distance: latestMapMarker
            ? Math.hypot(
                marker.x - latestMapMarker.x,
                marker.y - latestMapMarker.y,
              )
            : 0,
        }))
        .filter(
          (
            item,
          ): item is {
            marker: GymMap["markers"][number];
            project: Project;
            distance: number;
          } =>
            Boolean(
              item.project &&
              item.project.id !== latestSessionAttempt?.project_id &&
              (Boolean(backfillSession) ||
                item.project.status === "active" ||
                (item.project.status === "sent" &&
                  item.project.purpose !== "project")),
            ),
        )
        .sort((a, b) => a.distance - b.distance)
    : [];
  const currentWallArea = currentSessionProject?.wall_area
    ?.trim()
    .toLocaleLowerCase();
  const sameWallSessionLines = currentWallArea
    ? projects
        .filter(
          (project) =>
            project.id !== currentSessionProject?.id &&
            project.gym.trim().toLocaleLowerCase() ===
              loggingSession?.gym.trim().toLocaleLowerCase() &&
            project.wall_area?.trim().toLocaleLowerCase() === currentWallArea &&
            (project.status === "active" ||
              (project.status === "sent" && project.purpose !== "project")),
        )
        .map((project) => ({ project }))
    : [];
  const suggestedMapLines = currentWallArea
    ? sameWallSessionLines
    : mappedSessionLines;
  const reuseGym = gym.trim().toLocaleLowerCase();
  const reusablePhotoProjects = Array.from(
    new Map(
      projects
        .filter(
          (project) =>
            Boolean(reuseGym) &&
            project.gym.trim().toLocaleLowerCase() === reuseGym &&
            project.id !== editingProject?.id &&
            !project.photo_optional,
        )
        .map((project) => {
          const root =
            projects.find(
              (candidate) => candidate.id === project.source_project_id,
            ) || project;
          return [root.id, root] as const;
        }),
    ).values(),
  );
  const sharedPhotoCount = (project: Project) => {
    const rootId = project.source_project_id || project.id;
    return projects.filter(
      (candidate) => (candidate.source_project_id || candidate.id) === rootId,
    ).length;
  };
  function openProject(
    project: Project,
    origin: "projects" | "history" | "gym-map" = "projects",
  ) {
    if (!confirmLeave()) return;
    if (screen !== "project") {
      projectReturnScrollY.current = window.scrollY;
      setProjectReturnScreen(origin);
    }
    setOpened(project);
    setScreen("project");
  }
  function focusSessionSection(section: SessionSection) {
    setSessionSection(section);
    if (window.matchMedia("(max-width: 700px)").matches) {
      pendingScrollRestore.current = 0;
      if (section === "map") setScreen("gym-map");
      else setMobilePage(section === "lines" ? "lines" : "session");
      return;
    }
    document
      .getElementById(`session-${section}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function persistGymMap(map: GymMap, image?: Blob) {
    setBusy(true);
    setError("");
    try {
      await saveGymMap(map, image);
      const next = await listGymMaps();
      const previous = gymMapsRef.current;
      gymMapsRef.current = next;
      setGymMaps(next);
      window.requestAnimationFrame(() => {
        previous.forEach((item) => {
          if (item.image_url.startsWith("blob:"))
            URL.revokeObjectURL(item.image_url);
        });
      });
      setNotice(image ? "Gym map saved." : "Line position saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save gym map.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`app-shell mobile-page-${mobilePage} screen-${screen} ${backfillSession ? "is-backfill" : ""}`}
    >
      <header className="site-header">
        <button className="brand" onClick={back} aria-label="Bouldero home">
          <span className="brand-mark">
            b<span>·</span>
          </span>
          bouldero<span className="brand-period">.</span>
        </button>
        <div className="header-note">
          <span className="status-dot" /> ONE HOLD AT A TIME
        </div>
        <span className="version">FIELD NOTES / 0.4.1</span>
      </header>
      {activeSession && (
        <div className="active-session-bar">
          <button onClick={() => setQuickLogOpen(true)}>Quick log</button>
          <span>
            {activeSession.gym} ·{" "}
            {liveDuration(activeSession.started_at, clockNow)}
          </span>
          <button disabled={busy} onClick={finishSession}>
            End session
          </button>
        </div>
      )}
      <main>
        {backupReminder && (
          <section className="backup-reminder" aria-label="Session backup">
            <div>
              <strong>Session saved on this device</strong>
              <p>Export a copy before switching devices or versions.</p>
            </div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={downloadBackup}
            >
              Export session backup
            </button>
            <button
              className="text-button"
              onClick={() => setBackupReminder(false)}
            >
              Later
            </button>
          </section>
        )}
        {pendingImport && (
          <dialog
            ref={importDialog}
            className="backup-import-dialog"
            aria-labelledby="import-preview-title"
            onCancel={(event) => {
              event.preventDefault();
              if (!busy) setPendingImport(null);
            }}
          >
            <h2 id="import-preview-title">Review backup import</h2>
            <p>
              Nothing has been imported yet. Matching IDs will be replaced by
              this file. Other saved records stay.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Records</th>
                  <th>New</th>
                  <th>Replace</th>
                </tr>
              </thead>
              <tbody>
                {pendingImport.summary.preview?.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td>{row.added}</td>
                    <td>{row.replaced}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Gym map positions and grading preferences in the backup will also
              be restored.
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={downloadBackup}
            >
              Export current data first
            </button>
            <div className="data-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setPendingImport(null)}
              >
                Cancel import
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => restoreBackup(pendingImport.file, true)}
              >
                Confirm import
              </button>
            </div>
            {transferProgress && <p role="status">{transferProgress}</p>}
            {error && <p role="alert">{error}</p>}
          </dialog>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            {screen === "projects" && (
              <button
                onClick={() => {
                  setError("");
                  setLoading(true);
                  refresh()
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}
        {screen === "projects" && (
          <>
            <section className="page-intro">
              <div className="mobile-session-heading">
                <h1>{backfillSession ? "Past session" : "Session"}</h1>
                <p>
                  {backfillSession
                    ? new Date(backfillSession.started_at).toLocaleString([], {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : loggingSession
                      ? "Your climbing today"
                      : "Choose a gym and start climbing."}
                </p>
              </div>
              <div>
                <p className="eyebrow">
                  {loggingSession
                    ? backfillSession
                      ? "ADDING A PAST SESSION"
                      : "SESSION IN PROGRESS"
                    : "YOUR CLIMBING NOTEBOOK"}
                </p>
                <h1>
                  {loggingSession ? (
                    <>
                      {loggingSession.gym}
                      <br />
                      <span>Keep moving.</span>
                    </>
                  ) : (
                    <>
                      Ready when
                      <br />
                      <span>you are.</span>
                    </>
                  )}
                </h1>
                <p className="intro-copy">
                  {loggingSession
                    ? backfillSession
                      ? `${new Date(loggingSession.started_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. Open each line to add the attempts you remember.`
                      : `Started ${new Date(loggingSession.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Open a line to record an attempt.`
                    : "Start a session to record attempts, sends, and notes."}
                </p>
                {loggingSession && (
                  <nav
                    className="session-workspace-nav"
                    aria-label="Session workspace"
                  >
                    {sessionDestinations.map(({ section, label }) => (
                      <button
                        key={section}
                        aria-current={
                          sessionSection === section ? "page" : undefined
                        }
                        onClick={() => focusSessionSection(section)}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                )}
                {loggingSession && (
                  <div className="session-overview" id="session-summary">
                    <div
                      className="session-clock"
                      aria-label="Session elapsed time"
                    >
                      <span>SESSION TIME</span>
                      <strong>
                        {backfillSession
                          ? sessionDuration(
                              loggingSession.started_at,
                              loggingSession.ended_at,
                            )
                          : liveDuration(loggingSession.started_at, clockNow)}
                      </strong>
                    </div>
                    <dl
                      className="session-live-stats"
                      aria-label="Current session summary"
                    >
                      <div>
                        <dt>Attempts</dt>
                        <dd>{activeSessionAttempts.length}</dd>
                      </div>
                      {backfillSession ? (
                        <>
                          <div>
                            <dt>Lines logged</dt>
                            <dd>
                              {
                                new Set(
                                  activeSessionAttempts.map(
                                    (attempt) => attempt.project_id,
                                  ),
                                ).size
                              }
                            </dd>
                          </div>
                          <div>
                            <dt>Sends</dt>
                            <dd>
                              {
                                activeSessionAttempts.filter(isPerformanceSend)
                                  .length
                              }
                            </dd>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <dt>New lines</dt>
                            <dd>{sessionNewLines.length}</dd>
                          </div>
                          <div>
                            <dt>Carried in</dt>
                            <dd>{sessionCarriedLines.length}</dd>
                          </div>
                        </>
                      )}
                    </dl>
                  </div>
                )}
                {loggingSession && (
                  <section
                    className="session-current-line"
                    id="session-current"
                    aria-labelledby="current-line-title"
                  >
                    <div className="session-current-line-main">
                      <div>
                        <span className="mini-label">CURRENT LINE</span>
                        <h2 id="current-line-title">
                          {currentSessionProject
                            ? currentSessionProject.name
                            : "Choose where to begin"}
                        </h2>
                        <p>
                          {currentSessionProject
                            ? `${activeSessionAttempts.filter((attempt) => attempt.project_id === currentSessionProject.id).length} logged this session · ${attemptRecency(latestSessionAttempt.created_at, clockNow)}`
                            : "Open any line below. After the first attempt, it stays here as your current line."}
                        </p>
                      </div>
                      {currentSessionProject ? (
                        <button
                          onClick={() => openProject(currentSessionProject)}
                        >
                          <img src={currentSessionProject.photo_url} alt="" />
                          <span>Continue</span>
                          <Arrow />
                        </button>
                      ) : (
                        <button onClick={() => focusSessionSection("lines")}>
                          Find a line <Arrow />
                        </button>
                      )}
                    </div>
                    {currentSessionProject && (
                      <div
                        className="same-wall-suggestions"
                        aria-label="Same wall area lines"
                      >
                        <div className="same-wall-heading">
                          <span>
                            <strong>Same wall area</strong>
                            <small>
                              {currentWallArea
                                ? `Assigned wall area: ${currentSessionProject?.wall_area}`
                                : "Assign a wall area in Edit line. Opposite sides must use different areas."}
                            </small>
                          </span>
                          <button onClick={() => focusSessionSection("map")}>
                            View map →
                          </button>
                        </div>
                        {currentWallArea && sameWallSessionLines.length > 0 ? (
                          <div className="same-wall-list">
                            {sameWallSessionLines
                              .slice(0, 4)
                              .map(({ project }) => (
                                <button
                                  key={project.id}
                                  onClick={() => openProject(project)}
                                >
                                  <img src={project.photo_url} alt="" />
                                  <span>
                                    <strong>{project.name}</strong>
                                    <small>
                                      {
                                        activeSessionAttempts.filter(
                                          (attempt) =>
                                            attempt.project_id === project.id,
                                        ).length
                                      }{" "}
                                      this session
                                    </small>
                                  </span>
                                </button>
                              ))}
                          </div>
                        ) : (
                          <p className="same-wall-empty">
                            {currentWallArea
                              ? "No other eligible lines are assigned to this wall area."
                              : "Assign a wall area to this line to find lines on the same side of the wall."}
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                )}
                {loggingSession && activeGymMap?.image_url && (
                  <section
                    className="session-nearby"
                    id="session-map"
                    aria-labelledby="nearby-lines-title"
                  >
                    <div className="session-nearby-heading">
                      <div>
                        <span className="mini-label">GYM MAP</span>
                        <h2 id="nearby-lines-title">
                          {currentWallArea ? "Same wall area" : "Map nearby"}
                        </h2>
                        <p>
                          {currentWallArea
                            ? `Lines assigned to ${currentSessionProject?.wall_area}.`
                            : "Map distance only; nearby markers may be on opposite wall sides."}
                        </p>
                      </div>
                      <button onClick={() => setScreen("gym-map")}>
                        Open full map →
                      </button>
                    </div>
                    <div className="session-nearby-body">
                      <div className="session-map-preview">
                        <img
                          src={activeGymMap.image_url}
                          alt={`${loggingSession.gym} map`}
                        />
                        {activeGymMapMarkers.map((marker) => {
                          const mappedProject = projects.find(
                            (project) => project.id === marker.project_id,
                          );
                          if (!mappedProject) return null;
                          return (
                            <button
                              key={marker.project_id}
                              type="button"
                              aria-label={`Open ${mappedProject.name} from session map`}
                              className={
                                marker.project_id ===
                                latestSessionAttempt?.project_id
                                  ? "is-current"
                                  : ""
                              }
                              style={{
                                left: `${marker.x * 100}%`,
                                top: `${marker.y * 100}%`,
                                backgroundColor: projectMarkerColor(
                                  mappedProject.name,
                                  mappedProject.grade,
                                ),
                                color: markerTextColor(
                                  projectMarkerColor(
                                    mappedProject.name,
                                    mappedProject.grade,
                                  ),
                                ),
                              }}
                              onClick={() => openProject(mappedProject)}
                            >
                              {mappedProject.grade}
                            </button>
                          );
                        })}
                      </div>
                      <div className="nearby-line-list">
                        {suggestedMapLines
                          .slice(0, 5)
                          .map(({ project }, index) => (
                            <button
                              key={project.id}
                              onClick={() => openProject(project)}
                            >
                              <img src={project.photo_url} alt="" />
                              <span>
                                <strong>{project.name}</strong>
                                <small>
                                  {currentWallArea
                                    ? `Same wall area · ${index + 1}`
                                    : project.grade}
                                </small>
                              </span>
                              <Arrow />
                            </button>
                          ))}
                        {suggestedMapLines.length === 0 && (
                          <p>
                            {currentWallArea
                              ? "No other eligible lines are assigned to this wall area."
                              : "Place another active line on the map to see it here."}
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                )}
                {loggingSession && !activeGymMap?.image_url && (
                  <section
                    className="session-workspace-empty"
                    id="session-map"
                    aria-labelledby="session-map-empty-title"
                  >
                    <span className="mini-label">MAP / SAME WALL AREA</span>
                    <h2 id="session-map-empty-title">No gym map yet</h2>
                    <p>
                      Add a map when it helps. You can keep logging without one.
                    </p>
                    <button onClick={() => setScreen("gym-map")}>
                      Open Gym Map <Arrow />
                    </button>
                  </section>
                )}
              </div>
              <div className="mobile-session-lines-link">
                <button
                  className="button secondary"
                  onClick={() => {
                    setMobilePage("lines");
                    if (loggingSession) setGymFilter(loggingSession.gym);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  Browse lines <Arrow />
                </button>
              </div>
              <div className="hero-actions">
                {loggingSession ? (
                  <>
                    <button
                      className="button primary new-project"
                      onClick={start}
                    >
                      <span className="plus">+</span> New line <Arrow />
                    </button>
                    {backfillSession ? (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={finishBackfill}
                      >
                        Finish adding history
                      </button>
                    ) : null}
                    <button
                      className="text-button"
                      onClick={() => setScreen("history")}
                    >
                      History
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setScreen("gym-map")}
                    >
                      Gym map
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="button primary new-project"
                      onClick={() => {
                        setSessionGym(knownGyms[0] || "");
                        setSessionMode("live");
                        setScreen("start-session");
                      }}
                    >
                      Start a session <Arrow />
                    </button>
                    <button
                      className="text-button mobile-create-line"
                      onClick={start}
                    >
                      + New line
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setScreen("history")}
                    >
                      History
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setScreen("gym-map")}
                    >
                      Gym map
                    </button>
                  </>
                )}
              </div>
            </section>
            <div className="mobile-lines-page">
              <div
                className="section-heading library-heading"
                id="line-library"
              >
                <button
                  className="button secondary mobile-library-add"
                  onClick={start}
                >
                  + New line
                </button>
                <h2>
                  Line library{" "}
                  <span className="count">
                    {gymScopedProjects.length.toString().padStart(2, "0")}
                  </span>
                </h2>
                <span className="small-note">
                  {gymFilter !== "all"
                    ? `Browsing ${gymFilter}. Status and search stay inside this gym.`
                    : loggingSession
                      ? `${loggingSession.gym} lines appear first.`
                      : "Find the line you need."}
                </span>
              </div>
              <label className="library-scope">
                <span className="mini-label">GYM</span>
                <span className="gym-select-wrap">
                  <select
                    aria-label="Filter by gym"
                    value={gymFilter}
                    onChange={(event) => {
                      setGymFilter(event.target.value);
                      setStatusFilter("all");
                    }}
                  >
                    <option value="all">All gyms</option>
                    {knownGyms.map((knownGym) => (
                      <option key={knownGym} value={knownGym}>
                        {knownGym}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <section
                className="library-controls"
                aria-label="Line library controls"
              >
                <div
                  className="status-tabs"
                  role="group"
                  aria-label="Filter by status"
                >
                  {(
                    [
                      ["all", "All", gymScopedProjects.length],
                      ["active", "Ongoing", statusCounts.active],
                      ["sent", "Completed", statusCounts.sent],
                      ["archived", "Archived", statusCounts.archived],
                    ] as const
                  ).map(([value, label, count]) => (
                    <button
                      key={value}
                      className={statusFilter === value ? "active-tab" : ""}
                      aria-pressed={statusFilter === value}
                      onClick={() => setStatusFilter(value)}
                    >
                      {label} <span>{count}</span>
                    </button>
                  ))}
                </div>
                <div className="library-tools">
                  <label className="search-lines">
                    <span>
                      <SearchIcon />
                    </span>
                    <input
                      aria-label="Search lines"
                      type="search"
                      placeholder={
                        gymFilter === "all"
                          ? "Search all gyms"
                          : `Search in ${gymFilter}`
                      }
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <div
                    className="view-toggle"
                    role="group"
                    aria-label="View style"
                  >
                    <button
                      aria-label="Thumbnail view"
                      aria-pressed={viewMode === "grid"}
                      className={viewMode === "grid" ? "active-view" : ""}
                      onClick={() => setViewMode("grid")}
                    >
                      <GridIcon />
                    </button>
                    <button
                      aria-label="List view"
                      aria-pressed={viewMode === "list"}
                      className={viewMode === "list" ? "active-view" : ""}
                      onClick={() => setViewMode("list")}
                    >
                      <ListIcon />
                    </button>
                  </div>
                </div>
              </section>
              {loggingSession && (
                <section
                  className="session-lines-workspace"
                  id="session-lines"
                  aria-labelledby="session-lines-title"
                >
                  <div className="session-lines-heading">
                    <div>
                      <span className="mini-label">SESSION LINES</span>
                      <h2 id="session-lines-title">Find your next line</h2>
                    </div>
                    <span>
                      {sessionAttemptedProjects.length} tried ·{" "}
                      {sessionAvailableProjects.length} available
                    </span>
                  </div>
                  <div className="session-line-groups">
                    {(
                      [
                        {
                          key: "tried",
                          title: backfillSession
                            ? "Logged in this session"
                            : "Tried this session",
                          projects: sessionAttemptedProjects,
                          empty: "No attempts logged yet.",
                        },
                        {
                          key: "recent",
                          title: "Recent from earlier sessions",
                          projects: sessionRecentProjects,
                          empty: "No earlier ongoing lines to resume.",
                        },
                        {
                          key: "available",
                          title: "Not tried yet",
                          projects: sessionUntriedProjects,
                          empty: "No untouched ongoing lines at this gym.",
                        },
                      ] as const
                    ).map((group) => (
                      <div className="session-line-group" key={group.key}>
                        <div className="session-line-group-heading">
                          <h3>{group.title}</h3>
                          <span>{group.projects.length}</span>
                        </div>
                        {group.projects.length > 0 ? (
                          <div className="session-line-row">
                            {group.projects.map((project) => {
                              const sessionCount = activeSessionAttempts.filter(
                                (attempt) => attempt.project_id === project.id,
                              ).length;
                              const previousAttempt = lastAttemptAt(project.id);
                              return (
                                <button
                                  key={project.id}
                                  onClick={() => openProject(project)}
                                >
                                  <img src={project.photo_url} alt="" />
                                  <span>
                                    <strong>{project.name}</strong>
                                    <small>
                                      {group.key === "tried"
                                        ? `${sessionCount} ${sessionCount === 1 ? "attempt" : "attempts"}`
                                        : group.key === "recent" &&
                                            previousAttempt
                                          ? `Last tried ${attemptRecency(previousAttempt, clockNow)}`
                                          : "No attempts yet"}
                                    </small>
                                  </span>
                                  <Arrow />
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p>{group.empty}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {loading ? (
                <div className="empty-card loading">Opening your notebook…</div>
              ) : projects.length === 0 ? (
                <section className="empty-card">
                  <div className="art-wrap">
                    <span className="art-tag">THE NEXT MOVE IS YOURS</span>
                    <BoulderArt />
                  </div>
                  <div className="empty-copy">
                    <span className="mini-label">01 / START SOMETHING</span>
                    <h2>
                      {loggingSession ? "No lines saved" : "Meet your next"}
                      <br />
                      {loggingSession
                        ? "at this gym yet."
                        : "little obsession."}
                    </h2>
                    <p>
                      That route you can’t stop thinking about?
                      <br className="desktop-break" /> Give it a home. Snap a
                      photo, mark the holds,
                      <br className="desktop-break" /> and save it as a line.
                    </p>
                    <button
                      className="button dark"
                      onClick={
                        loggingSession
                          ? start
                          : () => {
                              setSessionGym(knownGyms[0] || "");
                              setSessionMode("live");
                              setScreen("start-session");
                            }
                      }
                    >
                      {loggingSession
                        ? "Create a line"
                        : "Start your first session"}{" "}
                      <Arrow />
                    </button>
                    <span className="under-button">
                      Just you, a wall, and a starting point.
                    </span>
                  </div>
                </section>
              ) : visibleProjects.length === 0 ? (
                <section className="filter-empty">
                  <span>
                    <SearchIcon />
                  </span>
                  <h2>No lines match.</h2>
                  <p>
                    {gymFilter === "all"
                      ? "Try another status or search."
                      : `No matching lines in ${gymFilter}.`}
                  </p>
                  <div className="filter-empty-actions">
                    {query && (
                      <button
                        className="button secondary"
                        onClick={() => setQuery("")}
                      >
                        Clear search
                      </button>
                    )}
                    {statusFilter !== "all" && (
                      <button
                        className="button secondary"
                        onClick={() => setStatusFilter("all")}
                      >
                        Show all statuses
                      </button>
                    )}
                    {gymFilter !== "all" && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setGymFilter("all");
                          setStatusFilter("all");
                        }}
                      >
                        Show all gyms
                      </button>
                    )}
                  </div>
                </section>
              ) : (
                <div
                  className={`project-grid ${viewMode === "list" ? "list-view" : ""}`}
                >
                  {visibleProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      attempts={attempts.filter(
                        (attempt) => attempt.project_id === project.id,
                      )}
                      now={clockNow}
                      sharedPhotoCount={sharedPhotoCount(project)}
                      open={() => openProject(project)}
                    />
                  ))}
                  <button className="add-card" onClick={start}>
                    <span>+</span>Something caught your eye?
                    <strong>
                      Add a line <Arrow />
                    </strong>
                  </button>
                </div>
              )}
            </div>
            <div className="how-it-works">
              <span className="mini-label">A SIMPLE START</span>
              <div>
                <span>01</span>
                <strong>Capture the route</strong>
                <p>A photo of your next line.</p>
              </div>
              <div>
                <span>02</span>
                <strong>Make your map</strong>
                <p>Mark the holds, from start to top.</p>
              </div>
              <div>
                <span>03</span>
                <strong>Come back to it</strong>
                <p>Your line, right where you left it.</p>
              </div>
            </div>
            <details className="data-tools-disclosure">
              <summary>
                Backup & transfer ·{" "}
                {lastBackup
                  ? `Last export ${new Date(lastBackup).toLocaleDateString()}`
                  : "No backup exported yet"}
              </summary>
              <section
                className="data-tools"
                aria-labelledby="data-tools-title"
              >
                <div className="data-tools-heading">
                  <span className="mini-label">YOUR DATA</span>
                  <h2 id="data-tools-title">Backup & transfer</h2>
                  {transferProgress && <p role="status">{transferProgress}</p>}
                  <p>
                    {cloudEnabled
                      ? `${projects.length} lines · ${sessions.length} sessions · ${attempts.length} attempts in your private cloud account.`
                      : `${projects.length} lines · ${sessions.length} sessions · ${attempts.length} attempts saved in this browser.`}
                  </p>
                </div>
                <div className="data-actions">
                  <div className="data-action-card">
                    <span>1 · SAVE A COPY</span>
                    <strong>Keep today’s data safe</strong>
                    <p>
                      Downloads lines, photos, sessions, attempts, and notes.
                    </p>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={downloadBackup}
                    >
                      Export backup
                    </button>
                  </div>
                  <div className="data-action-card">
                    <span>2 · MOVE TO A NEW VERSION</span>
                    <strong>Continue with your history</strong>
                    <p>
                      Importing a backup updates matching IDs without
                      duplicates. Existing matching records may be replaced;
                      export a backup first.
                    </p>
                    <label
                      className={`button secondary ${busy ? "disabled" : ""}`}
                    >
                      Import backup
                      <input
                        aria-label="Import backup"
                        type="file"
                        accept="application/json,.json"
                        disabled={busy}
                        onChange={(event) => {
                          restoreBackup(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              </section>
            </details>
          </>
        )}
        {screen === "history" && (
          <>
            <button className="back-button" onClick={back}>
              <Arrow back /> Home
            </button>
            <div className="editor-heading history-heading">
              <div>
                <p className="eyebrow">YOUR CLIMBING HISTORY</p>
                <h1>
                  Every session.
                  <br />
                  <span>One timeline.</span>
                </h1>
                <p className="intro-copy">
                  Look back at the lines, attempts, sends, and notes that got
                  you here.
                </p>
              </div>
            </div>
            <section className="history-stats" aria-label="Climbing statistics">
              <div>
                <span>Sessions</span>
                <strong>{sessions.length}</strong>
              </div>
              <div>
                <span>Attempts</span>
                <strong>{attempts.length}</strong>
              </div>
              <div>
                <span>Sends</span>
                <strong>{totalSends}</strong>
              </div>
              <div>
                <span>Latest</span>
                <strong>
                  {sessions[0]
                    ? new Date(sessions[0].started_at).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" },
                      )
                    : "—"}
                </strong>
              </div>
            </section>
            <div className="section-heading timeline-title">
              <h2>
                Session timeline{" "}
                <span className="count">
                  {sessions.length.toString().padStart(2, "0")}
                </span>
              </h2>
              <span className="small-note">Newest first.</span>
            </div>
            {sessionHistory.length === 0 ? (
              <section className="filter-empty history-empty">
                <span>
                  <Arrow />
                </span>
                <h2>Your first session starts the story.</h2>
                <p>Choose a gym and record an attempt to see it here.</p>
                <button
                  className="button primary"
                  onClick={() => {
                    setSessionGym(knownGyms[0] || "");
                    setSessionMode("live");
                    setScreen("start-session");
                  }}
                >
                  Start a session <Arrow />
                </button>
              </section>
            ) : (
              <section className="timeline">
                {sessionHistory.map((session) => {
                  const lineIds = Array.from(
                    new Set(
                      session.attempts.map((attempt) => attempt.project_id),
                    ),
                  );
                  const orderedAttempts = [...session.attempts].sort((a, b) =>
                    a.created_at.localeCompare(b.created_at),
                  );
                  const sessionSends =
                    session.attempts.filter(isPerformanceSend).length;
                  const longBreaks = orderedAttempts
                    .slice(1)
                    .map((attempt, index) => ({
                      before: orderedAttempts[index],
                      after: attempt,
                      minutes: Math.round(
                        (Date.parse(attempt.created_at) -
                          Date.parse(orderedAttempts[index].created_at)) /
                          60000,
                      ),
                    }))
                    .filter((gap) => gap.minutes >= 15);
                  return (
                    <article className="session-entry" key={session.id}>
                      <div className="timeline-marker">
                        <i />
                      </div>
                      <header>
                        <div>
                          <time>
                            {new Date(session.started_at).toLocaleDateString(
                              undefined,
                              {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}
                          </time>
                          <h2>{session.gym}</h2>
                          <div className="history-session-actions">
                            <button
                              disabled={busy}
                              onClick={() => beginSessionDetailsEdit(session)}
                            >
                              Edit session
                            </button>
                          </div>
                        </div>
                        <span
                          className={session.ended_at ? "" : "live-session"}
                        >
                          {sessionDuration(
                            session.started_at,
                            session.ended_at,
                          )}
                        </span>
                      </header>
                      {editingSessionId === session.id && (
                        <div className="session-details-editor">
                          <div className="session-editor-heading">
                            <strong>Edit session</strong>
                            <span>
                              Update the summary or open the session to edit its
                              activity.
                            </span>
                          </div>
                          <label>
                            Gym
                            <input
                              aria-label="Edit session gym"
                              value={sessionEditGym}
                              disabled={busy}
                              onChange={(event) =>
                                setSessionEditGym(event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Started
                            <input
                              aria-label="Edit session start"
                              type="datetime-local"
                              value={sessionEditStart}
                              disabled={busy}
                              onChange={(event) =>
                                setSessionEditStart(event.target.value)
                              }
                            />
                          </label>
                          {session.ended_at && (
                            <label>
                              Ended
                              <input
                                aria-label="Edit session end"
                                type="datetime-local"
                                value={sessionEditEnd}
                                disabled={busy}
                                onChange={(event) =>
                                  setSessionEditEnd(event.target.value)
                                }
                              />
                            </label>
                          )}
                          <div className="session-editor-actions">
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => saveSessionDetails(session)}
                            >
                              Save session details
                            </button>
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() => {
                                setBackfillSessionId(session.id);
                                setMobilePage("session");
                                setEditingSessionId(null);
                                setScreen("projects");
                              }}
                            >
                              Edit session activity
                            </button>
                            <button
                              className="button secondary"
                              disabled={busy}
                              onClick={() => {
                                if (confirmLeave()) setEditingSessionId(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                          <div className="session-editor-danger">
                            <div>
                              <strong>Delete session</strong>
                              <span>
                                Attempts in this session will also be deleted.
                              </span>
                            </div>
                            <button
                              className="history-delete-session"
                              disabled={busy}
                              onClick={() => removeSession(session)}
                            >
                              Delete session
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="session-summary">
                        <span>
                          {lineIds.length}{" "}
                          {lineIds.length === 1 ? "line" : "lines"}
                        </span>
                        <span>
                          {session.attempts.length}{" "}
                          {session.attempts.length === 1
                            ? "attempt"
                            : "attempts"}
                        </span>
                        <span>
                          {sessionSends} {sessionSends === 1 ? "send" : "sends"}
                        </span>
                      </div>
                      {session.ended_at && (
                        <button
                          className="session-report-toggle"
                          aria-expanded={expandedReportId === session.id}
                          onClick={() =>
                            setExpandedReportId((current) =>
                              current === session.id ? null : session.id,
                            )
                          }
                        >
                          <span>
                            <small>SESSION REPORT</small>
                            <strong>
                              {expandedReportId === session.id
                                ? "Hide session story"
                                : "View session story"}
                            </strong>
                          </span>
                          <Arrow />
                        </button>
                      )}
                      {expandedReportId === session.id && (
                        <section
                          className="session-report"
                          aria-label={`${session.gym} session report`}
                        >
                          <SessionReportVisuals
                            session={session}
                            attempts={session.attempts}
                            projects={projects}
                          />
                          <button
                            className="button secondary report-share"
                            onClick={() => shareSessionReport(session)}
                          >
                            Create &amp; share image card
                          </button>
                        </section>
                      )}
                      {lineIds.length === 0 ? (
                        <p className="no-attempts">
                          No attempts recorded in this session.
                        </p>
                      ) : (
                        <div className="session-lines">
                          {lineIds.map((projectId) => {
                            const project = projects.find(
                              (item) => item.id === projectId,
                            );
                            if (!project) return null;
                            const lineAttempts = session.attempts.filter(
                              (attempt) => attempt.project_id === projectId,
                            );
                            return (
                              <button
                                key={projectId}
                                className="timeline-line"
                                onClick={() => openProject(project, "history")}
                              >
                                <img src={project.photo_url} alt="" />
                                <span className="timeline-line-copy">
                                  <strong>{project.name}</strong>
                                  <small>
                                    {lineAttempts.length} attempts ·{" "}
                                    {
                                      lineAttempts.filter(
                                        (attempt) => attempt.result === "sent",
                                      ).length
                                    }{" "}
                                    sends
                                  </small>
                                  {lineAttempts
                                    .filter((attempt) => attempt.notes)
                                    .map((attempt) => (
                                      <em key={attempt.id}>
                                        “{attempt.notes}”
                                      </em>
                                    ))}
                                </span>
                                <Arrow />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
        {screen === "gym-map" && (
          <GymMapView
            gyms={knownGyms}
            maps={gymMaps}
            projects={projects}
            attempts={attempts}
            activeGym={
              loggingSession?.gym ||
              (gymFilter !== "all" ? gymFilter : projects[0]?.gym)
            }
            localMode={true}
            busy={busy}
            onBack={() => setScreen("projects")}
            onOpenProject={(project) => openProject(project, "gym-map")}
            onCreateAt={startFromMap}
            onSave={persistGymMap}
            viewState={gymMapViewState}
            onViewStateChange={setGymMapViewState}
          />
        )}
        {screen === "start-session" && (
          <>
            <button className="back-button" disabled={busy} onClick={back}>
              <Arrow back /> Home
            </button>
            <div className="editor-heading">
              <div>
                <p className="eyebrow">LOG A SESSION</p>
                <h1>When were you climbing?</h1>
                <p className="intro-copy">
                  Start now, or add a session from your climbing history.
                </p>
              </div>
              <span className="step-label">
                {sessionMode === "past" ? "PAST SESSION" : "TODAY"}
              </span>
            </div>
            <form className="session-form" onSubmit={beginSession}>
              <div
                className="session-mode"
                role="group"
                aria-label="Session time"
              >
                <button
                  type="button"
                  className={sessionMode === "live" ? "selected-result" : ""}
                  onClick={() => setSessionMode("live")}
                >
                  Start now
                </button>
                <button
                  type="button"
                  className={sessionMode === "past" ? "selected-result" : ""}
                  onClick={() => setSessionMode("past")}
                >
                  Add past session
                </button>
              </div>
              <label htmlFor="session-gym">Gym</label>
              <input
                id="session-gym"
                required
                maxLength={100}
                list="known-gyms"
                placeholder="Enter or choose a gym"
                value={sessionGym}
                disabled={busy}
                onChange={(event) => setSessionGym(event.target.value)}
              />
              <datalist id="known-gyms">
                {knownGyms.map((knownGym) => (
                  <option key={knownGym} value={knownGym} />
                ))}
              </datalist>
              {knownGyms.length > 0 && (
                <div className="gym-chips" aria-label="Recent gyms">
                  {knownGyms.map((knownGym) => (
                    <button
                      key={knownGym}
                      type="button"
                      onClick={() => setSessionGym(knownGym)}
                    >
                      {knownGym}
                    </button>
                  ))}
                </div>
              )}
              <label htmlFor="session-grade-system">Gym grading system</label>
              <select
                id="session-grade-system"
                value={sessionGradeSystem}
                disabled={busy || !sessionGym.trim()}
                onChange={(event) => {
                  setSessionGradeSystem(event.target.value);
                  void persistGymGradeSystem(
                    sessionGym,
                    event.target.value,
                  ).catch((error) => setError(error.message));
                }}
              >
                <option value="V">V scale</option>
                <option value="Font">Font scale</option>
                <option value="Custom">Custom</option>
              </select>
              {sessionMode === "past" && (
                <div className="past-session-times">
                  <label htmlFor="past-session-start">
                    Started
                    <input
                      id="past-session-start"
                      type="datetime-local"
                      required
                      value={pastSessionStart}
                      max={localDateTimeValue(new Date())}
                      disabled={busy}
                      onChange={(event) =>
                        setPastSessionStart(event.target.value)
                      }
                    />
                  </label>
                  <label htmlFor="past-session-end">
                    Ended
                    <input
                      id="past-session-end"
                      type="datetime-local"
                      required
                      value={pastSessionEnd}
                      max={localDateTimeValue(new Date())}
                      disabled={busy}
                      onChange={(event) =>
                        setPastSessionEnd(event.target.value)
                      }
                    />
                  </label>
                  <p>
                    After creating it, open each line and add the attempts you
                    remember. They will be saved under this time.
                  </p>
                </div>
              )}
              <button
                className="button primary"
                disabled={busy || !sessionGym.trim()}
              >
                {busy
                  ? "Saving…"
                  : sessionMode === "past"
                    ? "Create past session"
                    : "Start session"}{" "}
                <Arrow />
              </button>
            </form>
          </>
        )}
        {screen === "new" && (
          <>
            <button className="back-button" disabled={busy} onClick={back}>
              <Arrow back />{" "}
              {editingProject
                ? "Back to line"
                : loggingSession
                  ? "Back to session · All lines"
                  : "All lines"}
            </button>
            <div className="editor-heading">
              <div>
                <p className="eyebrow">A NEW BEGINNING</p>
                <h1>Save a line.</h1>
                <p className="intro-copy">
                  A photo. A few holds. A place to start.
                </p>
              </div>
              <span className="step-label">
                {!photo && !sourceProject
                  ? "01 / CHOOSE A PHOTO"
                  : !creationMode
                    ? "02 / CHOOSE HOW TO TRACK"
                    : editingProject
                      ? "EDIT / LINE DETAILS"
                      : "03 / ADD THE DETAILS"}
              </span>
            </div>
            {!photo && !sourceProject && !creationMode ? (
              <div className="upload-panel">
                {photoPreparing ? (
                  <div
                    className="photo-progress"
                    role="status"
                    aria-live="polite"
                  >
                    <span aria-hidden="true" />
                    <h2>Preparing your photo…</h2>
                    <p>Optimizing it for fast loading and hold mapping.</p>
                  </div>
                ) : (
                  <>
                    <div className="upload-icon">
                      <UploadIcon />
                    </div>
                    <h2>Photo or quick details?</h2>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => setCreationMode("count_only")}
                    >
                      Continue without a photo
                    </button>
                    <p>
                      Choose a clear photo of your route.
                      <br />
                      Keep the start and the top in frame.
                    </p>
                  </>
                )}
                <label className="photo-gym-field">
                  Gym <span>used to find photos from the same gym</span>
                  <input
                    aria-label="Gym for photo reuse"
                    placeholder="Choose or type a gym"
                    list="known-gyms"
                    maxLength={100}
                    value={gym}
                    disabled={busy}
                    onChange={(event) => setGym(event.target.value)}
                  />
                </label>
                <datalist id="known-gyms">
                  {knownGyms.map((knownGym) => (
                    <option key={knownGym} value={knownGym} />
                  ))}
                </datalist>
                <label className={`button primary ${busy ? "disabled" : ""}`}>
                  Choose a photo <Arrow />
                  <input
                    aria-label="Choose a photo"
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => choose(e.target.files?.[0])}
                  />
                </label>
                <label className="camera-link">
                  Take a photo
                  <input
                    aria-label="Take a photo"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={busy}
                    onChange={(e) => choose(e.target.files?.[0])}
                  />
                </label>
                <span className="small-note" aria-live="polite">
                  {photoPreparing
                    ? "Preparing your photo…"
                    : "JPEG, PNG or WebP · up to 30 MB"}
                </span>
                {!reuseGym && projects.length > 0 && (
                  <span className="reuse-guidance">
                    Enter a gym to reuse one of its saved wall photos.
                  </span>
                )}
                {reusablePhotoProjects.length > 0 && (
                  <div className="saved-photo-strip">
                    <span>or reuse a saved wall photo</span>
                    <div>
                      {reusablePhotoProjects.slice(0, 4).map((project) => (
                        <button
                          key={project.id}
                          onClick={() => reusePhoto(project)}
                        >
                          <img src={project.photo_url} alt="" />
                          <small>{project.name}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : !creationMode ? (
              <section className="mode-step">
                <div className="mode-photo">
                  <img src={preview} alt="Selected climbing wall" />
                  <button
                    type="button"
                    className="remove-photo"
                    aria-label="Remove selected photo"
                    disabled={busy}
                    onClick={removeSelectedPhoto}
                  >
                    ×
                  </button>
                  <span className="photo-ready">Photo ready</span>
                  {sourceProject && (
                    <span>Reusing photo from {sourceProject.name}</span>
                  )}
                  <label className={`change-photo ${busy ? "disabled" : ""}`}>
                    Choose a different photo
                    <input
                      aria-label="Choose a different photo"
                      type="file"
                      accept="image/*"
                      disabled={busy}
                      onChange={(event) => {
                        choose(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <div className="mode-copy">
                  <span className="mini-label">
                    HOW DO YOU WANT TO TRACK IT?
                  </span>
                  <h2>Choose for this line.</h2>
                  <button
                    className="mode-card"
                    onClick={() => setCreationMode("mapped")}
                  >
                    <span className="mode-symbol">⌖</span>
                    <span>
                      <strong>Map holds</strong>
                      <small>
                        Place each hold on the photo from start to top.
                      </small>
                    </span>
                    <Arrow />
                  </button>
                  <button
                    className="mode-card"
                    onClick={() => setCreationMode("count_only")}
                  >
                    <span className="mode-symbol">+1</span>
                    <span>
                      <strong>Reps only</strong>
                      <small>
                        Track repetitions without mapping individual holds.
                      </small>
                    </span>
                    <Arrow />
                  </button>
                </div>
              </section>
            ) : (
              <div className="editor-layout">
                <section className="mapping-panel">
                  {editingProject &&
                    attempts.some(
                      (attempt) => attempt.project_id === editingProject.id,
                    ) && (
                      <p className="edit-history-note">
                        Existing attempts will stay saved. Changing hold order
                        can change how their old hold numbers are displayed.
                      </p>
                    )}
                  <div className="photo-actions">
                    <label className={`change-photo ${busy ? "disabled" : ""}`}>
                      Choose a different photo
                      <input
                        aria-label="Choose a different photo"
                        type="file"
                        accept="image/*"
                        disabled={busy}
                        onChange={(event) => {
                          choose(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="remove-photo-text"
                      disabled={busy}
                      onClick={removeSelectedPhoto}
                    >
                      Remove photo
                    </button>
                  </div>
                  <div className="map-heading">
                    <strong>
                      {creationMode === "mapped"
                        ? "Tap each hold in climbing order."
                        : "Reps-only line — no markers needed."}
                    </strong>
                    <span>
                      {creationMode === "mapped"
                        ? `${holds.length} holds`
                        : "REPETITION TRACKING"}
                    </span>
                  </div>
                  {preview ? (
                    <HoldMap
                      src={preview}
                      holds={holds}
                      editable={creationMode === "mapped" && !busy}
                      selected={selected}
                      onSelect={setSelected}
                      onChange={(nextHolds) =>
                        setHolds(
                          nextHolds.map((hold, index) => ({
                            ...hold,
                            is_top:
                              finishType === "hold" &&
                              index === nextHolds.length - 1,
                          })),
                        )
                      }
                    />
                  ) : (
                    <div className="no-photo-state">
                      No photo needed. Add one later with Edit line & holds.
                    </div>
                  )}
                  {creationMode === "mapped" ? (
                    <>
                      <div className="map-toolbar">
                        <button
                          className="button secondary"
                          disabled={!holds.length || busy}
                          onClick={() => {
                            setHolds(holds.slice(0, -1));
                            setSelected("");
                          }}
                        >
                          ↶ Undo last hold
                        </button>
                        <button
                          className="text-button danger"
                          disabled={!selected || busy}
                          onClick={() => {
                            setHolds(
                              reorder(holds.filter((h) => h.id !== selected)),
                            );
                            setSelected("");
                          }}
                        >
                          Delete selected
                        </button>
                      </div>
                      <p className="map-hint">
                        Drag a marker to move it. Tap a marker to select it.
                        <br />
                        With a keyboard, use arrow keys to move the selected
                        marker.
                      </p>
                    </>
                  ) : (
                    <p className="map-hint">
                      Each tap of “Add attempt” increases this line’s count. You
                      can still attach notes or mark a send.
                    </p>
                  )}
                </section>
                <form
                  className="details-panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                >
                  <span className="mini-label">THE LITTLE DETAILS</span>
                  <h2>What’s the line?</h2>
                  <ColorGradePicker
                    gym={gym}
                    color={color}
                    grade={grade}
                    onColor={setColor}
                    onGrade={setGrade}
                    disabled={busy}
                  />
                  <label>
                    Gym <span>optional</span>
                    <input
                      placeholder="Your local spot"
                      maxLength={100}
                      value={gym}
                      disabled={busy}
                      onChange={(e) => {
                        setGym(e.target.value);
                        if (
                          draftMapPosition &&
                          draftMapPosition.gym.trim().toLocaleLowerCase() !==
                            e.target.value.trim().toLocaleLowerCase()
                        )
                          setDraftMapPosition(null);
                      }}
                    />
                  </label>
                  {!editingProject && draftGymMap?.image_url && (
                    <section className="creation-map-step">
                      <div>
                        <span className="mini-label">OPTIONAL · GYM MAP</span>
                        <h3>Place this line while it’s fresh.</h3>
                        <p>Tap its location now, or skip and place it later.</p>
                      </div>
                      <button
                        type="button"
                        className={`creation-map-canvas ${draftMapPosition ? "has-position" : ""}`}
                        onClick={(event) => {
                          if (busy) return;
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          setDraftMapPosition({
                            gym: draftGymMap.gym,
                            x: Math.max(
                              0,
                              Math.min(
                                1,
                                (event.clientX - rect.left) / rect.width,
                              ),
                            ),
                            y: Math.max(
                              0,
                              Math.min(
                                1,
                                (event.clientY - rect.top) / rect.height,
                              ),
                            ),
                          });
                        }}
                        aria-label="Choose this line's position on the gym map"
                      >
                        <img
                          src={draftGymMap.image_url}
                          alt={`${draftGymMap.gym} map`}
                        />
                        {draftMapPosition && (
                          <span
                            style={{
                              left: `${draftMapPosition.x * 100}%`,
                              top: `${draftMapPosition.y * 100}%`,
                            }}
                          >
                            NEW
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setDraftMapPosition(null)}
                        disabled={!draftMapPosition || busy}
                      >
                        {draftMapPosition ? "Skip for now" : "Not placed yet"}
                      </button>
                    </section>
                  )}
                  <label>
                    Wall area <span>optional</span>
                    <input
                      aria-label="Wall area"
                      list="gym-wall-areas"
                      value={wallArea}
                      maxLength={80}
                      disabled={busy}
                      onChange={(event) => setWallArea(event.target.value)}
                      placeholder="e.g. Slab A · front side"
                    />
                    <datalist id="gym-wall-areas">
                      {Array.from(
                        new Set(
                          projects
                            .filter(
                              (project) =>
                                project.gym.trim().toLocaleLowerCase() ===
                                gym.trim().toLocaleLowerCase(),
                            )
                            .map((project) => project.wall_area?.trim())
                            .filter(Boolean),
                        ),
                      ).map((area) => (
                        <option key={area} value={area} />
                      ))}
                    </datalist>
                    <small>
                      Reuse an area from this gym. Give opposite wall sides
                      different names; map proximity is not wall membership.
                    </small>
                  </label>
                  <label>
                    Line notes <span>optional</span>
                    <textarea
                      aria-label="Line notes optional"
                      placeholder="Beta, body position, pain warning, or what to remember next time."
                      maxLength={1000}
                      rows={5}
                      value={lineNotes}
                      disabled={busy}
                      onChange={(event) => setLineNotes(event.target.value)}
                    />
                  </label>
                  <fieldset className="purpose-type">
                    <legend>How will you use this line?</legend>
                    {(
                      [
                        [
                          "project",
                          "Project",
                          "A line you are working toward sending.",
                        ],
                        [
                          "warm_up",
                          "Warm-up",
                          "Reusable each session; sends stay out of performance totals.",
                        ],
                        [
                          "training",
                          "Training",
                          "Repeated movement or technique practice.",
                        ],
                      ] as const
                    ).map(([value, label, description]) => (
                      <button
                        key={value}
                        type="button"
                        className={purpose === value ? "selected-result" : ""}
                        onClick={() => setPurpose(value)}
                      >
                        <strong>{label}</strong>
                        <span>{description}</span>
                      </button>
                    ))}
                  </fieldset>
                  {creationMode === "mapped" && (
                    <fieldset className="finish-type">
                      <legend>How does this line finish?</legend>
                      <button
                        type="button"
                        className={
                          finishType === "hold" ? "selected-result" : ""
                        }
                        onClick={() => {
                          setFinishType("hold");
                          setHolds(
                            holds.map((hold, index) => ({
                              ...hold,
                              is_top: index === holds.length - 1,
                            })),
                          );
                        }}
                      >
                        <strong>Finish hold</strong>
                        <span>Control the last marked hold.</span>
                      </button>
                      <button
                        type="button"
                        className={
                          finishType === "top_out" ? "selected-result" : ""
                        }
                        onClick={() => {
                          setFinishType("top_out");
                          setHolds(
                            holds.map((hold) => ({ ...hold, is_top: false })),
                          );
                        }}
                      >
                        <strong>Top out</strong>
                        <span>Finish by climbing onto the wall top.</span>
                      </button>
                    </fieldset>
                  )}
                  <button
                    className="button primary save-button mobile-sticky-action"
                    disabled={
                      busy ||
                      !color.trim() ||
                      !grade.trim() ||
                      (creationMode === "mapped" && !holds.length)
                    }
                  >
                    {busy
                      ? "Saving your line…"
                      : editingProject
                        ? "Save changes"
                        : "Done · Save line"}
                    <Arrow />
                  </button>
                  <p className="save-note">
                    {creationMode === "count_only"
                      ? "No markers needed. Repetitions and notes stay attached to this line."
                      : !holds.length
                        ? "Add at least one hold to save your route."
                        : `${holds.length} holds mapped. Ready when you are.`}
                  </p>
                </form>
              </div>
            )}
          </>
        )}
        {screen === "project" && opened && (
          <>
            <button className="back-button" onClick={back}>
              <Arrow back />{" "}
              {projectReturnScreen === "history"
                ? "History"
                : projectReturnScreen === "gym-map"
                  ? "Gym map"
                  : mobilePage === "lines"
                    ? "Back to lines"
                    : loggingSession
                      ? "Back to session"
                      : "All lines"}
            </button>
            <div className="editor-heading">
              <div>
                <p className="eyebrow">
                  {opened.route_mode === "count_only"
                    ? "COUNT-ONLY LINE"
                    : "YOUR ROUTE, MAPPED"}
                </p>
                <h1>{opened.name}</h1>
                <p className="intro-copy">
                  {[opened.grade, opened.gym].filter(Boolean).join(" · ") ||
                    "A new line. A fresh start."}
                </p>
              </div>
              <span className="pill">
                {opened.status === "active"
                  ? "Ongoing"
                  : opened.status === "sent"
                    ? "Completed"
                    : "Archived"}
              </span>
            </div>
            <div className="route-counts" aria-label="Line attempt totals">
              <strong>
                {attempts.filter((a) => a.project_id === opened.id).length}{" "}
                attempts total
              </strong>
              <span>
                {
                  attempts.filter(
                    (a) =>
                      a.project_id === opened.id &&
                      a.session_id === loggingSession?.id,
                  ).length
                }{" "}
                this session
              </span>
            </div>
            {loggingSession &&
              openedMatchesLoggingGym &&
              opened.status !== "archived" &&
              (opened.status === "active" ||
                opened.purpose !== "project" ||
                backfillSession) && (
                <div className="route-action-dock">
                  <span>
                    {attemptHoldId
                      ? `Hold ${opened.holds.find((h) => h.id === attemptHoldId)?.order_index} · ${attemptHoldResult}`
                      : "Record this try"}
                  </span>
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      (attemptStartMode === "partial" &&
                        (!attemptStartHoldId || !attemptHoldId))
                    }
                    onClick={() => recordAttempt("attempt")}
                  >
                    {attemptCount > 1
                      ? `Add ${attemptCount} attempts`
                      : "Add attempt"}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => recordAttempt("sent", { directSend: true })}
                  >
                    Send
                  </button>
                </div>
              )}
            {lastLoggedLine === opened.id && loggingSession && (
              <section
                className="climb-saved-next"
                aria-label="Continue climbing"
              >
                <span>
                  Climb saved · try again here, or find your next line.
                </span>
                <button className="button secondary" onClick={back}>
                  {projectReturnScreen === "gym-map"
                    ? "Return to map"
                    : projectReturnScreen === "history"
                      ? "Return to history"
                      : "Find next line"}
                </button>
              </section>
            )}
            <div className="editor-layout">
              <section className="mapping-panel">
                {loggingSession &&
                  openedMatchesLoggingGym &&
                  opened.route_mode === "mapped" &&
                  (opened.status === "active" ||
                    (opened.status === "sent" &&
                      opened.purpose !== "project") ||
                    Boolean(backfillSession)) && (
                    <div className="attempt-map-instruction">
                      <span className="mini-label">LOG AN ATTEMPT</span>
                      <strong>Tap the last hold you reached.</strong>
                      <small>
                        Choose below whether you controlled it or only touched
                        it.
                      </small>
                    </div>
                  )}
                <HoldMap
                  src={opened.photo_url}
                  holds={opened.holds}
                  selectable={Boolean(
                    loggingSession &&
                    openedMatchesLoggingGym &&
                    opened.route_mode === "mapped" &&
                    (opened.status === "active" ||
                      (opened.status === "sent" &&
                        opened.purpose !== "project") ||
                      backfillSession),
                  )}
                  selected={attemptHoldId}
                  onSelect={(id) => {
                    setAttemptHoldId(id);
                    setAttemptHoldResult("controlled");
                  }}
                />
              </section>
              <aside className="project-details">
                <div className="status-actions" aria-label="Line status">
                  <button disabled={busy} onClick={() => editProject(opened)}>
                    Edit line & holds
                  </button>
                  {opened.status !== "active" && (
                    <button
                      disabled={busy}
                      onClick={() => changeProjectStatus("active")}
                    >
                      Move to ongoing
                    </button>
                  )}
                  {opened.status !== "sent" && (
                    <button
                      disabled={busy}
                      onClick={() => changeProjectStatus("sent")}
                    >
                      Mark completed
                    </button>
                  )}
                  {opened.status !== "archived" && (
                    <button
                      disabled={busy}
                      onClick={() => changeProjectStatus("archived")}
                    >
                      Archive
                    </button>
                  )}
                  <button
                    className="delete-line-button"
                    disabled={busy}
                    onClick={() => removeProject(opened)}
                  >
                    Delete line
                  </button>
                </div>
                <section className="line-notes">
                  <div className="line-notes-heading">
                    <span className="mini-label">LINE NOTES</span>
                    {!editingLineNotes && (
                      <button
                        type="button"
                        onClick={() => {
                          setLineNotesDraft(opened.notes);
                          setEditingLineNotes(true);
                        }}
                      >
                        {opened.notes ? "Edit notes" : "Add notes"}
                      </button>
                    )}
                  </div>
                  {editingLineNotes ? (
                    <div className="inline-note-editor">
                      <textarea
                        aria-label="Edit line notes"
                        maxLength={1000}
                        rows={4}
                        value={lineNotesDraft}
                        disabled={busy}
                        onChange={(event) =>
                          setLineNotesDraft(event.target.value)
                        }
                      />
                      <div>
                        <button
                          className="button primary"
                          type="button"
                          disabled={busy}
                          onClick={saveInlineLineNotes}
                        >
                          Save notes
                        </button>
                        <button
                          className="button secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (confirmLeave()) setEditingLineNotes(false);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : opened.notes ? (
                    <p>{opened.notes}</p>
                  ) : (
                    <p className="empty-note">No notes yet.</p>
                  )}
                </section>
                <div className="line-purpose" aria-label="Line purpose">
                  <span>USE</span>
                  <strong>
                    {opened.purpose === "warm_up"
                      ? "Warm-up"
                      : opened.purpose === "training"
                        ? "Training"
                        : "Project"}
                  </strong>
                  {opened.purpose === "warm_up" && (
                    <small>
                      Reusable · excluded from performance send totals
                    </small>
                  )}
                </div>
                <span className="mini-label">ATTEMPT LOG</span>
                <h2>
                  {loggingSession && !openedMatchesLoggingGym
                    ? `This session is at ${loggingSession.gym}.`
                    : loggingSession &&
                        (opened.status === "active" ||
                          (opened.status === "sent" &&
                            opened.purpose !== "project") ||
                          Boolean(backfillSession))
                      ? "How did it go?"
                      : loggingSession && opened.status === "sent"
                        ? "Line sent. What’s next?"
                        : opened.status !== "active"
                          ? "Move to ongoing to log."
                          : "Start a session to log."}
                </h2>
                {loggingSession && !openedMatchesLoggingGym && (
                  <p className="empty-note">
                    You can still edit this line and its notes. To record an
                    attempt, use a session at {opened.gym || "this line’s gym"}.
                  </p>
                )}
                {loggingSession &&
                openedMatchesLoggingGym &&
                (opened.status === "active" ||
                  (opened.status === "sent" && opened.purpose !== "project") ||
                  Boolean(backfillSession)) ? (
                  <>
                    <button
                      className="button secondary quick-send desktop-quick-send"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        recordAttempt("sent", { directSend: true })
                      }
                    >
                      {busy
                        ? "Saving…"
                        : opened.purpose === "warm_up"
                          ? "Log warm-up send"
                          : opened.purpose === "training"
                            ? "Log training send"
                            : "Log send"}{" "}
                      <Arrow />
                    </button>
                    <form className="attempt-form" onSubmit={addAttempt}>
                      <span className="mini-label">LOG ANOTHER TRY</span>
                      {opened.route_mode === "mapped" && (
                        <div className="attempt-hold-picker">
                          <fieldset className="attempt-start">
                            <legend>Where did this attempt start?</legend>
                            <button
                              type="button"
                              className={
                                attemptStartMode === "ground"
                                  ? "selected-result"
                                  : ""
                              }
                              onClick={() => {
                                setAttemptStartMode("ground");
                                setAttemptStartHoldId("");
                              }}
                            >
                              From the ground
                            </button>
                            <button
                              type="button"
                              className={
                                attemptStartMode === "partial"
                                  ? "selected-result"
                                  : ""
                              }
                              onClick={() => setAttemptStartMode("partial")}
                            >
                              From a hold
                            </button>
                            {attemptStartMode === "partial" && (
                              <select
                                aria-label="Partial starting hold"
                                required
                                value={attemptStartHoldId}
                                onChange={(event) =>
                                  setAttemptStartHoldId(event.target.value)
                                }
                              >
                                <option value="">Choose starting hold</option>
                                {opened.holds.map((hold) => (
                                  <option key={hold.id} value={hold.id}>
                                    Hold {hold.order_index}
                                  </option>
                                ))}
                              </select>
                            )}
                          </fieldset>
                          <label>
                            Last hold controlled <span>required</span>
                          </label>
                          <p>
                            Use the route image above to choose the hold, then
                            record whether it was controlled or touched.
                          </p>
                          {attemptHoldId && (
                            <fieldset className="hold-result-choice">
                              <legend>What happened at this hold?</legend>
                              <button
                                type="button"
                                className={
                                  attemptHoldResult === "controlled"
                                    ? "selected-result"
                                    : ""
                                }
                                onClick={() =>
                                  setAttemptHoldResult("controlled")
                                }
                              >
                                <strong>Controlled</strong>
                                <span>Stable enough to use or move from.</span>
                              </button>
                              <button
                                type="button"
                                className={
                                  attemptHoldResult === "touched"
                                    ? "selected-result"
                                    : ""
                                }
                                onClick={() => setAttemptHoldResult("touched")}
                              >
                                <strong>Touched</strong>
                                <span>
                                  Made contact but did not control it.
                                </span>
                              </button>
                            </fieldset>
                          )}
                          {attemptStartMode === "ground" && (
                            <button
                              type="button"
                              className={`hold-zero-choice ${!attemptHoldId ? "selected-result" : ""}`}
                              onClick={() => {
                                setAttemptHoldId("");
                                setAttemptHoldResult("controlled");
                              }}
                            >
                              <strong>Couldn’t get into the start</strong>
                              <span>
                                The starting position was not controlled.
                              </span>
                            </button>
                          )}
                          {attemptHoldId && (
                            <strong>
                              {attemptHoldResult === "touched"
                                ? "Touched hold "
                                : "Controlled hold "}
                              {
                                opened.holds.find(
                                  (hold) => hold.id === attemptHoldId,
                                )?.order_index
                              }
                            </strong>
                          )}
                        </div>
                      )}
                      <label className="attempt-count" htmlFor="attempt-count">
                        Attempts to add
                        <span>Use this after several similar tries</span>
                        <input
                          id="attempt-count"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={20}
                          value={attemptCount}
                          disabled={busy}
                          onChange={(event) =>
                            setAttemptCount(Number(event.target.value) || 1)
                          }
                        />
                      </label>
                      <label htmlFor="attempt-notes">
                        Notes <span>optional</span>
                      </label>
                      <textarea
                        id="attempt-notes"
                        maxLength={500}
                        rows={4}
                        placeholder="What worked? What will you try next?"
                        value={attemptNotes}
                        disabled={busy}
                        onChange={(event) =>
                          setAttemptNotes(event.target.value)
                        }
                      />
                    </form>
                  </>
                ) : opened.status === "active" ? (
                  <button
                    className="button primary save-button mobile-sticky-action"
                    onClick={() => {
                      setSessionGym(opened.gym || knownGyms[0] || "");
                      setSessionMode("live");
                      setScreen("start-session");
                    }}
                  >
                    Start a session <Arrow />
                  </button>
                ) : null}
                {activeSession && opened.status === "sent" && (
                  <section
                    className="completion-next"
                    aria-label="After send actions"
                  >
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>Completed this session</strong>
                      <p>The send is saved and this line moved to Completed.</p>
                    </div>
                    {switchableLines[0] ? (
                      <button
                        className="button primary"
                        onClick={() => openProject(switchableLines[0])}
                      >
                        Next ongoing line <Arrow />
                      </button>
                    ) : (
                      <button className="button secondary" onClick={back}>
                        Return to lines
                      </button>
                    )}
                  </section>
                )}
                {loggingSession && switchableLines.length > 0 && (
                  <details
                    className="line-switcher"
                    aria-labelledby="switch-line-title"
                  >
                    <summary id="switch-line-title">
                      Switch lines · {switchableLines.length}
                    </summary>
                    <div className="line-switcher-list">
                      {switchableLines.map((project) => (
                        <button
                          key={project.id}
                          onClick={() => openProject(project)}
                        >
                          <img src={project.photo_url} alt="" />
                          <span>
                            <strong>{project.name}</strong>
                            <small>
                              {project.grade} ·{" "}
                              {project.holds.length
                                ? `${project.holds.length} holds`
                                : "Reps only"}
                            </small>
                          </span>
                          <Arrow />
                        </button>
                      ))}
                    </div>
                  </details>
                )}
                <dl>
                  <div>
                    <dt>
                      {opened.route_mode === "count_only"
                        ? "Tracking"
                        : "Holds mapped"}
                    </dt>
                    <dd>
                      {opened.route_mode === "count_only"
                        ? "Repetitions"
                        : opened.holds.length}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {opened.route_mode === "count_only"
                        ? "Photo"
                        : "Top hold"}
                    </dt>
                    <dd>
                      {opened.route_mode === "count_only"
                        ? "Saved"
                        : opened.holds.some((h) => h.is_top)
                          ? `Hold ${opened.holds.length}`
                          : "Not marked"}
                    </dd>
                  </div>
                  <div>
                    <dt>Total attempts</dt>
                    <dd>{openedAttempts.length}</dd>
                  </div>
                  <div>
                    <dt>Sends recorded</dt>
                    <dd>
                      {
                        openedAttempts.filter(
                          (attempt) => attempt.result === "sent",
                        ).length
                      }
                    </dd>
                  </div>
                  {opened.sent_at && (
                    <div>
                      <dt>Completed</dt>
                      <dd>
                        {new Date(opened.sent_at).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric", year: "numeric" },
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
                {!opened.photo_optional && (
                  <button
                    className="button secondary reuse-button"
                    onClick={() => reusePhoto(opened)}
                  >
                    Create another line from this photo <Arrow />
                  </button>
                )}
                {openedAttempts.length > 0 && (
                  <div className="attempt-history">
                    <span className="mini-label">RECENT ATTEMPTS</span>
                    {openedAttempts.map((attempt, index) => (
                      <article key={attempt.id}>
                        <div>
                          <strong>
                            #{openedAttempts.length - index} ·{" "}
                            {attempt.result === "sent" ? "Sent" : "Attempted"}
                          </strong>
                          <time>
                            {sessions.find(
                              (session) => session.id === attempt.session_id,
                            )?.gym || "Session"}{" "}
                            ·{" "}
                            {new Date(attempt.created_at).toLocaleString(
                              undefined,
                              {
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              },
                            )}
                          </time>
                        </div>
                        {attempt.started_hold_id && (
                          <small>
                            Started from hold{" "}
                            {opened.holds.find(
                              (hold) => hold.id === attempt.started_hold_id,
                            )?.order_index || "—"}
                          </small>
                        )}
                        {attempt.topped_out && <small>Reached TOP OUT</small>}
                        {attempt.ended_hold_id && (
                          <small>
                            {attempt.hold_result === "touched"
                              ? "Touched hold "
                              : "Controlled hold "}
                            {opened.holds.find(
                              (hold) => hold.id === attempt.ended_hold_id,
                            )?.order_index || "—"}
                          </small>
                        )}
                        {!attempt.ended_hold_id &&
                          !attempt.topped_out &&
                          opened.route_mode === "mapped" && (
                            <small>Couldn’t get into the start</small>
                          )}
                        {editingAttemptDraft?.id === attempt.id ? (
                          <div className="attempt-details-editor">
                            <label>
                              Result
                              <select
                                aria-label="Edit attempt result"
                                value={editingAttemptDraft.result}
                                disabled={busy}
                                onChange={(event) => {
                                  if (!editingAttemptOriginalResult.current)
                                    editingAttemptOriginalResult.current =
                                      editingAttemptDraft.result;
                                  setEditingAttemptDraft({
                                    ...editingAttemptDraft,
                                    result: event.target
                                      .value as Attempt["result"],
                                  });
                                }}
                              >
                                <option value="attempt">Attempted</option>
                                <option value="sent">Sent</option>
                              </select>
                            </label>
                            <label>
                              Time
                              <input
                                aria-label="Edit attempt time"
                                type="datetime-local"
                                value={editingAttemptDraft.created_at}
                                disabled={busy}
                                onChange={(event) =>
                                  setEditingAttemptDraft({
                                    ...editingAttemptDraft,
                                    created_at: event.target.value,
                                  })
                                }
                              />
                            </label>
                            {opened.route_mode === "mapped" && (
                              <>
                                <label>
                                  Started from
                                  <select
                                    aria-label="Edit attempt starting hold"
                                    value={
                                      editingAttemptDraft.started_hold_id || ""
                                    }
                                    disabled={busy}
                                    onChange={(event) =>
                                      setEditingAttemptDraft({
                                        ...editingAttemptDraft,
                                        started_hold_id:
                                          event.target.value || null,
                                      })
                                    }
                                  >
                                    <option value="">Ground</option>
                                    {opened.holds.map((hold) => (
                                      <option key={hold.id} value={hold.id}>
                                        Hold {hold.order_index}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {editingAttemptDraft.result === "attempt" && (
                                  <label>
                                    Last reached hold
                                    <select
                                      aria-label="Edit attempt ending hold"
                                      value={
                                        editingAttemptDraft.ended_hold_id || ""
                                      }
                                      disabled={busy}
                                      onChange={(event) =>
                                        setEditingAttemptDraft({
                                          ...editingAttemptDraft,
                                          ended_hold_id:
                                            event.target.value || null,
                                          hold_result: event.target.value
                                            ? editingAttemptDraft.hold_result ||
                                              "controlled"
                                            : null,
                                        })
                                      }
                                    >
                                      <option value="">
                                        Couldn’t get into the start
                                      </option>
                                      {opened.holds.map((hold) => (
                                        <option key={hold.id} value={hold.id}>
                                          Hold {hold.order_index}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                                {editingAttemptDraft.result === "attempt" &&
                                  editingAttemptDraft.ended_hold_id && (
                                    <label>
                                      Hold result
                                      <select
                                        aria-label="Edit hold result"
                                        value={
                                          editingAttemptDraft.hold_result ||
                                          "controlled"
                                        }
                                        disabled={busy}
                                        onChange={(event) =>
                                          setEditingAttemptDraft({
                                            ...editingAttemptDraft,
                                            hold_result: event.target.value as
                                              "controlled" | "touched",
                                          })
                                        }
                                      >
                                        <option value="controlled">
                                          Controlled
                                        </option>
                                        <option value="touched">Touched</option>
                                      </select>
                                    </label>
                                  )}
                              </>
                            )}
                            <label>
                              Notes
                              <textarea
                                aria-label="Edit attempt notes"
                                maxLength={500}
                                rows={3}
                                value={editingAttemptDraft.notes}
                                disabled={busy}
                                onChange={(event) =>
                                  setEditingAttemptDraft({
                                    ...editingAttemptDraft,
                                    notes: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <div>
                              <button
                                type="button"
                                className="button primary"
                                disabled={busy}
                                onClick={() => saveAttemptEdit(opened)}
                              >
                                Save attempt
                              </button>
                              <button
                                type="button"
                                className="button secondary"
                                disabled={busy}
                                onClick={() => {
                                  if (confirmLeave())
                                    setEditingAttemptDraft(null);
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : editingAttemptId === attempt.id ? (
                          <div className="inline-note-editor attempt-note-editor">
                            <textarea
                              aria-label={`Edit note for attempt ${openedAttempts.length - index}`}
                              maxLength={500}
                              rows={3}
                              value={attemptNotesDraft}
                              disabled={busy}
                              onChange={(event) =>
                                setAttemptNotesDraft(event.target.value)
                              }
                            />
                            <div>
                              <button
                                type="button"
                                className="button primary"
                                disabled={busy}
                                onClick={() => saveAttemptNote(attempt)}
                              >
                                Save note
                              </button>
                              <button
                                type="button"
                                className="button secondary"
                                disabled={busy}
                                onClick={() => {
                                  if (confirmLeave()) setEditingAttemptId(null);
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {attempt.notes && <p>{attempt.notes}</p>}
                            <div className="attempt-edit-actions">
                              <button
                                type="button"
                                className="edit-attempt-note"
                                onClick={() => {
                                  if (!confirmLeave()) return;
                                  editingAttemptOriginalResult.current =
                                    attempt.result;
                                  setEditingAttemptDraft({
                                    ...attempt,
                                    created_at: localDateTimeValue(
                                      new Date(attempt.created_at),
                                    ),
                                  });
                                }}
                              >
                                Edit attempt
                              </button>
                              <button
                                type="button"
                                className="edit-attempt-note"
                                onClick={() => {
                                  if (!confirmLeave()) return;
                                  setEditingAttemptId(attempt.id);
                                  setAttemptNotesDraft(attempt.notes);
                                }}
                              >
                                {attempt.notes ? "Edit note only" : "Add note"}
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
      {["projects", "history", "gym-map"].includes(screen) && (
        <nav className="mobile-main-nav" aria-label="Main navigation">
          {(
            [
              { key: "session", label: "Session", icon: "current" },
              { key: "lines", label: "Lines", icon: "lines" },
              { key: "gym-map", label: "Map", icon: "map" },
              { key: "history", label: "History", icon: "summary" },
            ] as const
          ).map(({ key, label, icon }) => {
            const current = screen === "projects" ? mobilePage : screen;
            return (
              <button
                key={key}
                aria-current={current === key ? "page" : undefined}
                onClick={() => {
                  if (current === key || !confirmLeave()) return;
                  setEditingSessionId(null);
                  mobileScroll.current[
                    current as keyof typeof mobileScroll.current
                  ] = window.scrollY;
                  pendingScrollRestore.current = mobileScroll.current[key];
                  if (key === "session" || key === "lines") {
                    setMobilePage(key);
                    setScreen("projects");
                  } else setScreen(key);
                }}
              >
                <SessionDestinationIcon section={icon} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      )}
      <footer>
        <span>
          bouldero. <span className="footer-tagline">Keep showing up.</span>
        </span>
        <span>
          {cloudEnabled ? "Private cloud workspace" : "Saved on this device"}
          <span className="footer-dot">·</span>Version 0.4.1
        </span>
      </footer>
      {quickLogOpen && activeSession && (
        <QuickLog
          session={activeSession}
          projects={projects}
          onClose={() => setQuickLogOpen(false)}
          onOpen={(project) => {
            setQuickLogOpen(false);
            setBackfillSessionId(null);
            setMobilePage("session");
            openProject(project);
          }}
          onSaved={async () => {
            await refresh();
            setNotice("Climb recorded. Ready for the next line.");
          }}
        />
      )}
      {!cloudEnabled && (
        <p className="local-note">
          Local mode · Lines stay in this browser. Clearing site data removes
          them. Connect Supabase for cloud storage.
        </p>
      )}
      {notice && (
        <div className="toast" role="status">
          ✓ {notice}
        </div>
      )}
    </div>
  );
}
function ProjectCard({
  project,
  attempts,
  now,
  sharedPhotoCount,
  open,
}: {
  project: Project;
  attempts: Attempt[];
  now: number;
  sharedPhotoCount: number;
  open: () => void;
}) {
  const lastAttempt = attempts[0];
  const attemptsToday = attempts.filter((attempt) =>
    isToday(attempt.created_at),
  ).length;
  return (
    <button className="project-card" onClick={open}>
      <div className="card-photo">
        <img src={project.photo_url} alt={project.name} />
        <span className="card-badge">{project.grade || "LINE"}</span>
        <span className={`card-status status-${project.status}`}>
          {project.status === "active"
            ? "Ongoing"
            : project.status === "sent"
              ? "Completed"
              : "Archived"}
        </span>
        {sharedPhotoCount > 1 && (
          <span className="shared-wall-badge">
            Shared wall · {sharedPhotoCount} lines
          </span>
        )}
        <span className="card-arrow">
          <Arrow />
        </span>
      </div>
      <div className="card-copy">
        <h3>{project.name}</h3>
        <p>
          {project.route_mode === "count_only"
            ? "Reps only"
            : `${project.holds.length} holds mapped`}
          <span>
            {project.route_mode === "count_only"
              ? project.purpose === "warm_up"
                ? "Warm-up"
                : project.purpose === "training"
                  ? "Training"
                  : "Project"
              : project.holds.some((h) => h.is_top)
                ? "TOP marked"
                : "Route saved"}
          </span>
        </p>
        <div className="card-attempts">
          <span>
            <strong>{attempts.length}</strong> total
          </span>
          <span>
            <strong>{attemptsToday}</strong> today
          </span>
          <span>
            {lastAttempt
              ? attemptRecency(lastAttempt.created_at, now)
              : "Not attempted yet"}
          </span>
        </div>
      </div>
    </button>
  );
}
