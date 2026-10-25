"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { preparePhoto } from "@/lib/photo";
import { markerTextColor, projectMarkerColor } from "@/lib/color";
import type { Attempt, GymMap, Project } from "@/lib/types";

type Props = {
  gyms: string[];
  maps: GymMap[];
  projects: Project[];
  attempts: Attempt[];
  activeGym?: string;
  localMode: boolean;
  busy: boolean;
  onBack: () => void;
  onOpenProject: (project: Project) => void;
  onCreateAt: (gym: string, x: number, y: number) => void;
  onSave: (map: GymMap, image?: Blob) => Promise<void>;
  viewState: GymMapViewState;
  onViewStateChange: (state: GymMapViewState) => void;
};

export type GymMapViewState = {
  gym: string;
  mode: "browse" | "edit";
  query: string;
  unmappedOnly: boolean;
  selectedProjectId: string;
  zoom: number;
  panX: number;
  panY: number;
};

export const initialGymMapViewState = (gym = ""): GymMapViewState => ({
  gym,
  mode: "browse",
  query: "",
  unmappedOnly: false,
  selectedProjectId: "",
  zoom: 1,
  panX: 0,
  panY: 0,
});

const sameGym = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export const cleanedPilotMaps = [
  {
    gym: "Movement Mountain View",
    cleaned: "/gym-maps/cleaned/movement-mountain-view-first-floor.png",
    source: "/gym-maps/source/movement-mountain-view-first-floor.jpg",
  },
  {
    gym: "Movement Santa Clara",
    cleaned: "/gym-maps/cleaned/movement-santa-clara-first-floor.png",
    source: "/gym-maps/source/movement-santa-clara-first-floor.jpg",
  },
] as const;

export const cleanedPilotGyms = cleanedPilotMaps.map((item) => item.gym);

function shortCode(project: Project) {
  const prefix =
    project.name
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 2)
      .toUpperCase() || "LN";
  return `${prefix}-${project.id.replace(/-/g, "").slice(-4).toUpperCase()}`;
}

function relativeAttemptTime(value?: string) {
  if (!value) return "No attempts yet";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(value)) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function GymMapView({
  gyms,
  maps,
  projects,
  attempts,
  activeGym,
  localMode,
  busy,
  onBack,
  onOpenProject,
  onCreateAt,
  onSave,
  viewState,
  onViewStateChange,
}: Props) {
  const [gym, setGym] = useState(viewState.gym || activeGym || gyms[0] || "");
  const [mode, setMode] = useState<GymMapViewState["mode"]>(viewState.mode);
  const [selectedProjectId, setSelectedProjectId] = useState(
    viewState.selectedProjectId,
  );
  const [query, setQuery] = useState(viewState.query);
  const [unmappedOnly, setUnmappedOnly] = useState(viewState.unmappedOnly);
  const [zoom, setZoom] = useState(viewState.zoom);
  const [pan, setPan] = useState({ x: viewState.panX, y: viewState.panY });
  const [creatingAt, setCreatingAt] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [quickSkippedIds, setQuickSkippedIds] = useState<string[]>([]);
  const [quickTotal, setQuickTotal] = useState(0);
  const [quickPlaced, setQuickPlaced] = useState(0);
  const [lastPlacement, setLastPlacement] = useState<{
    projectId: string;
    previousMarker?: GymMap["markers"][number];
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [showPilotSource, setShowPilotSource] = useState(false);
  const [showPilotReview, setShowPilotReview] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageRetry, setImageRetry] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [localError, setLocalError] = useState("");
  const [draggingMarker, setDraggingMarker] = useState<{
    projectId: string;
    x: number;
    y: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{
    distance: number;
    zoom: number;
    panX: number;
    panY: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const panStartRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const suppressMarkerClickRef = useRef(false);
  const pilotMap = cleanedPilotMaps.find((item) => sameGym(item.gym, gym));

  async function useCleanedPilotMap() {
    if (!pilotMap || busy) return;
    setLocalError("");
    setImageReady(false);
    try {
      await onSave({
        id: map?.id || crypto.randomUUID(),
        gym,
        image_url: pilotMap.cleaned,
        markers: map?.markers || [],
        updated_at: new Date().toISOString(),
      });
      setShowPilotSource(false);
      setShowPilotReview(false);
      resetCamera();
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "Could not apply the cleaned pilot map.",
      );
    }
  }
  const map = maps.find((item) => sameGym(item.gym, gym));
  const gymProjects = useMemo(
    () =>
      projects.filter(
        (project) => sameGym(project.gym, gym) && project.status !== "archived",
      ),
    [projects, gym],
  );
  const visibleMarkers = useMemo(
    () =>
      (map?.markers || []).filter((marker) =>
        gymProjects.some((project) => project.id === marker.project_id),
      ),
    [map?.markers, gymProjects],
  );
  const markerGroups = useMemo(() => {
    if (mode === "edit" || zoom >= 1.7)
      return visibleMarkers.map((marker) => [marker]);
    const groups: GymMap["markers"][] = [];
    const threshold = 0.055 / zoom;
    visibleMarkers.forEach((marker) => {
      const group = groups.find((items) => {
        const center = items.reduce(
          (sum, item) => ({ x: sum.x + item.x, y: sum.y + item.y }),
          { x: 0, y: 0 },
        );
        return (
          Math.hypot(
            marker.x - center.x / items.length,
            marker.y - center.y / items.length,
          ) < threshold
        );
      });
      if (group) group.push(marker);
      else groups.push([marker]);
    });
    return groups;
  }, [visibleMarkers, mode, zoom]);
  const markersInView = useMemo(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return visibleMarkers;
    return visibleMarkers.filter((marker) => {
      const x = pan.x + marker.x * canvas.offsetWidth * zoom;
      const y = pan.y + marker.y * canvas.offsetHeight * zoom;
      return (
        x >= -24 &&
        y >= -24 &&
        x <= viewport.clientWidth + 24 &&
        y <= viewport.clientHeight + 24
      );
    });
  }, [visibleMarkers, pan, zoom, imageReady]);
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return gymProjects
      .filter(
        (project) =>
          !unmappedOnly ||
          !map?.markers.some((marker) => marker.project_id === project.id),
      )
      .filter(
        (project) =>
          !normalized ||
          [
            project.name,
            project.grade,
            project.notes,
            project.status,
            shortCode(project),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalized),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [gymProjects, map?.markers, query, unmappedOnly]);
  const quickQueue = useMemo(
    () =>
      gymProjects
        .filter(
          (project) =>
            !map?.markers.some((marker) => marker.project_id === project.id) &&
            !quickSkippedIds.includes(project.id),
        )
        .sort((a, b) => {
          const aGroup = a.source_project_id || a.id;
          const bGroup = b.source_project_id || b.id;
          return (
            aGroup.localeCompare(bGroup) ||
            b.created_at.localeCompare(a.created_at)
          );
        }),
    [gymProjects, map?.markers, quickSkippedIds],
  );
  const quickProject = quickMode
    ? gymProjects.find((project) => project.id === selectedProjectId)
    : undefined;

  useEffect(() => {
    onViewStateChange({
      gym,
      mode,
      query,
      unmappedOnly,
      selectedProjectId,
      zoom,
      panX: pan.x,
      panY: pan.y,
    });
  }, [
    gym,
    mode,
    query,
    unmappedOnly,
    selectedProjectId,
    zoom,
    pan,
    onViewStateChange,
  ]);

  function clampPan(next: { x: number; y: number }, nextZoom = zoom) {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return next;
    const maxX = Math.max(
      0,
      canvas.offsetWidth * nextZoom - viewport.clientWidth,
    );
    const maxY = Math.max(
      0,
      canvas.offsetHeight * nextZoom - viewport.clientHeight,
    );
    return {
      x: Math.min(0, Math.max(-maxX, next.x)),
      y: Math.min(0, Math.max(-maxY, next.y)),
    };
  }

  function changeZoom(nextZoom: number, center?: { x: number; y: number }) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounded = Math.min(4, Math.max(1, nextZoom));
    const point = center || {
      x: viewport.clientWidth / 2,
      y: viewport.clientHeight / 2,
    };
    const ratio = bounded / zoom;
    const nextPan = clampPan(
      {
        x: point.x - (point.x - pan.x) * ratio,
        y: point.y - (point.y - pan.y) * ratio,
      },
      bounded,
    );
    setZoom(bounded);
    setPan(nextPan);
  }

  function resetCamera() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function focusPoint(x: number, y: number) {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const nextZoom = Math.min(4, Math.max(2, zoom + 0.8));
    setZoom(nextZoom);
    setPan(
      clampPan(
        {
          x: viewport.clientWidth / 2 - x * canvas.offsetWidth * nextZoom,
          y: viewport.clientHeight / 2 - y * canvas.offsetHeight * nextZoom,
        },
        nextZoom,
      ),
    );
  }

  function viewportPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointersRef.current.size === 1) {
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    } else if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      gestureRef.current = {
        distance: Math.hypot(
          points[1].x - points[0].x,
          points[1].y - points[0].y,
        ),
        zoom,
        panX: pan.x,
        panY: pan.y,
        centerX: (points[0].x + points[1].x) / 2 - rect.left,
        centerY: (points[0].y + points[1].y) / 2 - rect.top,
      };
      panStartRef.current = null;
    }
  }

  function viewportPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointersRef.current.size === 2 && gestureRef.current) {
      const points = [...pointersRef.current.values()];
      const gesture = gestureRef.current;
      const distance = Math.hypot(
        points[1].x - points[0].x,
        points[1].y - points[0].y,
      );
      const nextZoom = Math.min(
        4,
        Math.max(1, (gesture.zoom * distance) / Math.max(1, gesture.distance)),
      );
      const ratio = nextZoom / gesture.zoom;
      setZoom(nextZoom);
      setPan(
        clampPan(
          {
            x: gesture.centerX - (gesture.centerX - gesture.panX) * ratio,
            y: gesture.centerY - (gesture.centerY - gesture.panY) * ratio,
          },
          nextZoom,
        ),
      );
    } else if (
      pointersRef.current.size === 1 &&
      panStartRef.current &&
      zoom > 1
    ) {
      setPan(
        clampPan({
          x: panStartRef.current.panX + event.clientX - panStartRef.current.x,
          y: panStartRef.current.panY + event.clientY - panStartRef.current.y,
        }),
      );
    }
  }

  function viewportPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    gestureRef.current = null;
    panStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useEffect(() => {
    setImageReady(
      Boolean(imageRef.current?.complete && imageRef.current.naturalWidth),
    );
    setImageFailed(false);
    setLocalError("");
  }, [map?.image_url, imageRetry]);

  function beginQuickMap() {
    const unmapped = gymProjects
      .filter(
        (project) =>
          !map?.markers.some((marker) => marker.project_id === project.id),
      )
      .sort((a, b) => {
        const aGroup = a.source_project_id || a.id;
        const bGroup = b.source_project_id || b.id;
        return (
          aGroup.localeCompare(bGroup) ||
          b.created_at.localeCompare(a.created_at)
        );
      });
    setCreatingAt(false);
    setQuery("");
    setUnmappedOnly(true);
    setQuickSkippedIds([]);
    setQuickTotal(unmapped.length);
    setQuickPlaced(0);
    setLastPlacement(null);
    setMode("edit");
    setQuickMode(true);
    setSelectedProjectId(unmapped[0]?.id || "");
  }

  function stopQuickMap() {
    setQuickMode(false);
    setSelectedProjectId("");
    setQuickSkippedIds([]);
    setLastPlacement(null);
  }

  function skipQuickProject() {
    if (!selectedProjectId) return;
    const remaining = quickQueue.filter(
      (project) => project.id !== selectedProjectId,
    );
    setQuickSkippedIds((current) => [...current, selectedProjectId]);
    setSelectedProjectId(remaining[0]?.id || "");
  }

  async function undoQuickPlacement() {
    if (!map || !lastPlacement || busy) return;
    const markers = map.markers.filter(
      (marker) => marker.project_id !== lastPlacement.projectId,
    );
    if (lastPlacement.previousMarker)
      markers.push(lastPlacement.previousMarker);
    await onSave({ ...map, markers, updated_at: new Date().toISOString() });
    setQuickPlaced((current) => Math.max(0, current - 1));
    setSelectedProjectId(lastPlacement.projectId);
    setLastPlacement(null);
  }

  async function upload(file?: File) {
    if (!file || !gym) return;
    setPreparing(true);
    setLocalError("");
    try {
      const image = await preparePhoto(file);
      const next: GymMap = map || {
        id: crypto.randomUUID(),
        gym,
        image_url: "",
        markers: [],
        updated_at: new Date().toISOString(),
      };
      await onSave(
        { ...next, gym, updated_at: new Date().toISOString() },
        image,
      );
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : "Could not prepare this map image.",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function place(event: React.MouseEvent<HTMLDivElement>) {
    if (!map || busy || mode !== "edit" || (!selectedProjectId && !creatingAt))
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    if (creatingAt) {
      onCreateAt(gym, x, y);
      return;
    }
    const previousMarker = map.markers.find(
      (item) => item.project_id === selectedProjectId,
    );
    const nextQuickProject = quickMode
      ? quickQueue.find((project) => project.id !== selectedProjectId)
      : undefined;
    await onSave({
      ...map,
      markers: [
        ...map.markers.filter((item) => item.project_id !== selectedProjectId),
        { project_id: selectedProjectId, x, y },
      ],
      updated_at: new Date().toISOString(),
    });
    if (quickMode) {
      setLastPlacement({ projectId: selectedProjectId, previousMarker });
      setQuickPlaced((current) => current + 1);
      setSelectedProjectId(nextQuickProject?.id || "");
    } else setSelectedProjectId("");
  }

  async function remove(projectId: string) {
    if (!map || busy) return;
    await onSave({
      ...map,
      markers: map.markers.filter((item) => item.project_id !== projectId),
      updated_at: new Date().toISOString(),
    });
  }

  function markerPosition(marker: GymMap["markers"][number]) {
    return draggingMarker?.projectId === marker.project_id
      ? draggingMarker
      : marker;
  }

  function beginMarkerDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    marker: GymMap["markers"][number],
  ) {
    if (busy || quickMode || creatingAt || mode !== "edit") return;
    dragMovedRef.current = false;
    suppressMarkerClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedProjectId(marker.project_id);
    setDraggingMarker({
      projectId: marker.project_id,
      x: marker.x,
      y: marker.y,
    });
  }

  function moveMarker(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingMarker || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    if (Math.hypot(x - draggingMarker.x, y - draggingMarker.y) > 0.003) {
      dragMovedRef.current = true;
    }
    setDraggingMarker((current) => (current ? { ...current, x, y } : current));
  }

  async function finishMarkerDrag(
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    if (!map || !draggingMarker) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const nextPosition = draggingMarker;
    const moved = dragMovedRef.current;
    setDraggingMarker(null);
    if (!moved) return;
    suppressMarkerClickRef.current = true;
    await onSave({
      ...map,
      markers: map.markers.map((marker) =>
        marker.project_id === nextPosition.projectId
          ? { ...marker, x: nextPosition.x, y: nextPosition.y }
          : marker,
      ),
      updated_at: new Date().toISOString(),
    });
    setSelectedProjectId("");
  }

  return (
    <section className="gym-map-page">
      <button className="back-link" onClick={onBack}>
        ← Back
      </button>
      <header className="gym-map-heading">
        <div>
          <p className="eyebrow">GYM MAP</p>
          <h1>
            Find the next
            <br />
            <span>move nearby.</span>
          </h1>
          <p>
            Browse the wall safely. Enter Edit only when you want to change the
            map.
          </p>
        </div>
        <label>
          Gym
          <select
            value={gym}
            onChange={(event) => {
              setGym(event.target.value);
              setMode("browse");
              setSelectedProjectId("");
              setCreatingAt(false);
              setQuickMode(false);
              setQuickSkippedIds([]);
              setShowPilotReview(false);
              setShowPilotSource(false);
              setLocalError("");
              resetCamera();
            }}
          >
            {gyms.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </header>
      {localError && (
        <p className="gym-map-error" role="alert">
          {localError}
        </p>
      )}
      {!localMode ? (
        <div className="gym-map-empty">
          <strong>Gym maps are not available in cloud mode yet.</strong>
          <p>
            Map upload and line placement will return when gym maps can sync
            safely across devices.
          </p>
        </div>
      ) : !gym ? (
        <div className="gym-map-empty">
          <strong>No gym yet.</strong>
          <p>Create a line or start a session to add your first gym.</p>
        </div>
      ) : !map?.image_url ? (
        <div className="gym-map-empty-options">
          {pilotMap && (
            <section className="gym-map-pilot-card">
              <div>
                <span>CLEANED PILOT MAP</span>
                <strong>{pilotMap.gym} · first floor</strong>
                <p>
                  Chalk removed, printed geometry preserved, and prepared for
                  phone testing.
                </p>
              </div>
              <img src={pilotMap.cleaned} alt={`${pilotMap.gym} cleaned map`} />
              <div className="gym-map-pilot-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={useCleanedPilotMap}
                  disabled={busy}
                >
                  Use cleaned map
                </button>
                <button
                  type="button"
                  onClick={() => setShowPilotSource((current) => !current)}
                >
                  {showPilotSource ? "Hide source" : "Compare source"}
                </button>
              </div>
              {showPilotSource && (
                <figure className="gym-map-pilot-source">
                  <img
                    src={pilotMap.source}
                    alt={`${pilotMap.gym} source photo`}
                  />
                  <figcaption>
                    Original source photo · kept separately
                  </figcaption>
                </figure>
              )}
            </section>
          )}
          <label className="gym-map-uploader">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => upload(event.target.files?.[0])}
              disabled={preparing || busy}
            />
            <span>{preparing ? "Preparing map…" : "+ Upload gym map"}</span>
            <small>A floor plan, wall overview, or quick sketch works.</small>
          </label>
        </div>
      ) : (
        <>
          <div className="gym-map-modebar">
            <div
              className="gym-map-mode-switch"
              role="group"
              aria-label="Gym map mode"
            >
              <button
                type="button"
                className={mode === "browse" ? "is-active" : ""}
                aria-pressed={mode === "browse"}
                onClick={() => {
                  setMode("browse");
                  setSelectedProjectId("");
                  setCreatingAt(false);
                  setQuickMode(false);
                }}
              >
                Browse
              </button>
              <button
                type="button"
                className={mode === "edit" ? "is-active" : ""}
                aria-pressed={mode === "edit"}
                onClick={() => setMode("edit")}
              >
                Edit map
              </button>
            </div>
            <div className="gym-map-zoom" role="group" aria-label="Map zoom">
              <button
                type="button"
                onClick={() => changeZoom(zoom - 0.5)}
                disabled={zoom <= 1}
                aria-label="Zoom out"
              >
                −
              </button>
              <output aria-label="Map zoom level">
                {Math.round(zoom * 100)}%
              </output>
              <button
                type="button"
                onClick={() => changeZoom(zoom + 0.5)}
                disabled={zoom >= 4}
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                onClick={resetCamera}
                disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
              >
                Reset
              </button>
            </div>
          </div>
          <p className={`gym-map-mode-note is-${mode}`} role="status">
            <span aria-hidden="true" />
            {mode === "browse"
              ? "Browse mode · Tap a line to open its details. Markers stay locked."
              : "Edit mode · Placement and marker movement are unlocked."}
          </p>
          {mode === "edit" && (
            <div className="gym-map-toolbar">
              <button
                type="button"
                className={`button ${creatingAt ? "primary" : "secondary"}`}
                onClick={() => {
                  setCreatingAt((current) => !current);
                  setQuickMode(false);
                  setSelectedProjectId("");
                }}
              >
                {creatingAt ? "Cancel new line" : "+ Add a line here"}
              </button>
              {!quickMode && quickQueue.length > 0 && (
                <button
                  type="button"
                  className="button primary"
                  onClick={beginQuickMap}
                >
                  Quick map {quickQueue.length} lines
                </button>
              )}
              <label className="replace-map">
                Replace map
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => upload(event.target.files?.[0])}
                  disabled={preparing || busy}
                />
              </label>
              {pilotMap && map.image_url !== pilotMap.cleaned && (
                <button
                  type="button"
                  className="replace-map"
                  onClick={() => setShowPilotReview((current) => !current)}
                  disabled={busy}
                >
                  {showPilotReview
                    ? "Close cleaned-map review"
                    : "Review cleaned pilot map"}
                </button>
              )}
              <span>
                {quickMode
                  ? `${quickPlaced} placed · ${quickSkippedIds.length} skipped`
                  : creatingAt
                    ? "Tap its location on the map."
                    : selectedProjectId
                      ? "Tap the map or drag its marker to move this line."
                      : `${visibleMarkers.length} of ${gymProjects.length} current lines placed`}
              </span>
            </div>
          )}
          {mode === "edit" && showPilotReview && pilotMap && (
            <section className="gym-map-pilot-card gym-map-pilot-review">
              <div>
                <span>CLEANED PILOT MAP</span>
                <strong>{pilotMap.gym} · first floor</strong>
                <p>
                  Review the cleaned map and its original source before
                  replacing the current image. Existing line markers stay in
                  place.
                </p>
              </div>
              <img src={pilotMap.cleaned} alt={`${pilotMap.gym} cleaned map`} />
              <div className="gym-map-pilot-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={useCleanedPilotMap}
                  disabled={busy}
                >
                  Use cleaned map
                </button>
                <button
                  type="button"
                  onClick={() => setShowPilotSource((current) => !current)}
                >
                  {showPilotSource ? "Hide source" : "Compare source"}
                </button>
              </div>
              {showPilotSource && (
                <figure className="gym-map-pilot-source">
                  <img
                    src={pilotMap.source}
                    alt={`${pilotMap.gym} source photo`}
                  />
                  <figcaption>
                    Original source photo · kept separately
                  </figcaption>
                </figure>
              )}
            </section>
          )}
          {quickMode && (
            <section className="quick-map-panel" aria-live="polite">
              {quickProject ? (
                <>
                  <div className="quick-map-progress">
                    <span>QUICK MAP</span>
                    <strong>
                      {Math.min(
                        quickTotal,
                        quickPlaced + quickSkippedIds.length + 1,
                      )}{" "}
                      / {quickTotal}
                    </strong>
                  </div>
                  <div className="quick-map-current">
                    <img src={quickProject.photo_url} alt="" />
                    <div>
                      <span>
                        <strong>{quickProject.name}</strong>
                        <em>{shortCode(quickProject)}</em>
                      </span>
                      <small>
                        {
                          attempts.filter(
                            (attempt) => attempt.project_id === quickProject.id,
                          ).length
                        }{" "}
                        attempts ·{" "}
                        {relativeAttemptTime(
                          attempts
                            .filter(
                              (attempt) =>
                                attempt.project_id === quickProject.id,
                            )
                            .sort((a, b) =>
                              b.created_at.localeCompare(a.created_at),
                            )[0]?.created_at,
                        )}
                      </small>
                      {quickProject.notes && <p>“{quickProject.notes}”</p>}
                      <b>Tap this line’s position on the map.</b>
                    </div>
                  </div>
                  <div className="quick-map-actions">
                    <button
                      type="button"
                      onClick={skipQuickProject}
                      disabled={busy}
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={undoQuickPlacement}
                      disabled={!lastPlacement || busy}
                    >
                      Undo last
                    </button>
                    <button
                      type="button"
                      onClick={stopQuickMap}
                      disabled={busy}
                    >
                      Exit quick map
                    </button>
                  </div>
                </>
              ) : (
                <div className="quick-map-complete">
                  <strong>
                    {quickPlaced
                      ? "Quick mapping complete."
                      : "No unmapped lines left."}
                  </strong>
                  <p>
                    {quickPlaced} placed
                    {quickSkippedIds.length
                      ? ` · ${quickSkippedIds.length} skipped`
                      : ""}
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={undoQuickPlacement}
                      disabled={!lastPlacement || busy}
                    >
                      Undo last
                    </button>
                    <button
                      type="button"
                      className="button primary"
                      onClick={stopQuickMap}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
          <div
            ref={viewportRef}
            className={`gym-map-viewport ${zoom > 1 ? "is-zoomed" : ""}`}
            onPointerDown={viewportPointerDown}
            onPointerMove={viewportPointerMove}
            onPointerUp={viewportPointerUp}
            onPointerCancel={viewportPointerUp}
            onWheel={(event) => {
              if (!event.ctrlKey) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              changeZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25), {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
              });
            }}
          >
            <div
              ref={canvasRef}
              className={`gym-map-canvas ${mode === "edit" && (selectedProjectId || creatingAt) ? "is-placing" : ""} ${imageReady ? "is-ready" : "is-loading"}`}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
              onClick={place}
            >
              {!imageReady && !imageFailed && (
                <div className="gym-map-image-status" role="status">
                  Loading gym map…
                </div>
              )}
              <img
                ref={imageRef}
                key={`${map.image_url}:${imageRetry}`}
                src={map.image_url}
                alt={`${gym} map`}
                onLoad={() => {
                  setImageReady(true);
                  setImageFailed(false);
                }}
                onError={() => {
                  setImageReady(false);
                  setImageFailed(true);
                }}
              />
              {imageFailed && (
                <div className="gym-map-image-status" role="alert">
                  Could not load this map.{" "}
                  <button
                    onClick={() => {
                      setImageFailed(false);
                      setImageRetry((v) => v + 1);
                    }}
                  >
                    Retry map
                  </button>
                </div>
              )}
              {markerGroups.map((group, index) => {
                const center = group.reduce(
                  (sum, marker) => ({
                    x: sum.x + marker.x,
                    y: sum.y + marker.y,
                  }),
                  { x: 0, y: 0 },
                );
                const x = center.x / group.length;
                const y = center.y / group.length;
                if (group.length > 1)
                  return (
                    <button
                      type="button"
                      key={`cluster-${index}`}
                      className="gym-map-cluster"
                      style={{
                        left: `${x * 100}%`,
                        top: `${y * 100}%`,
                        transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        focusPoint(x, y);
                      }}
                      aria-label={`${group.length} lines in this area. Zoom in.`}
                    >
                      <strong>{group.length}</strong>
                      <span>lines</span>
                    </button>
                  );
                const marker = group[0];
                const project = gymProjects.find(
                  (item) => item.id === marker.project_id,
                );
                if (!project) return null;
                const position = markerPosition(marker);
                const selected = selectedProjectId === project.id;
                const markerColor = projectMarkerColor(
                  project.name,
                  project.grade,
                );
                return (
                  <button
                    key={marker.project_id}
                    className={`gym-map-marker ${selected ? "is-selected" : ""} ${draggingMarker?.projectId === project.id ? "is-dragging" : ""}`}
                    style={{
                      left: `${position.x * 100}%`,
                      top: `${position.y * 100}%`,
                      zIndex: selected ? 4 : index + 1,
                      backgroundColor: markerColor,
                      color: markerTextColor(markerColor),
                      transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (mode === "edit") beginMarkerDrag(event, marker);
                    }}
                    onPointerMove={mode === "edit" ? moveMarker : undefined}
                    onPointerUp={mode === "edit" ? finishMarkerDrag : undefined}
                    onPointerCancel={() => setDraggingMarker(null)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressMarkerClickRef.current) {
                        suppressMarkerClickRef.current = false;
                        return;
                      }
                      if (mode === "browse" && !creatingAt && !quickMode)
                        onOpenProject(project);
                      else if (mode === "edit")
                        setSelectedProjectId(project.id);
                    }}
                    aria-label={
                      mode === "browse"
                        ? `Open ${project.name}, ${shortCode(project)}`
                        : `Select ${project.name}, ${shortCode(project)} to move`
                    }
                  >
                    <span>{project.grade}</span>
                    <strong>{project.name}</strong>
                  </button>
                );
              })}
            </div>
          </div>
          {mode === "browse" && (
            <section
              className="gym-map-visible-lines"
              aria-label="Lines in visible map area"
            >
              <div>
                <p className="mini-label">IN THIS VIEW</p>
                <h2>
                  {markersInView.length}{" "}
                  {markersInView.length === 1 ? "line" : "lines"}
                </h2>
              </div>
              <div>
                {markersInView.map((marker) => {
                  const project = gymProjects.find(
                    (item) => item.id === marker.project_id,
                  );
                  if (!project) return null;
                  return (
                    <button
                      type="button"
                      key={marker.project_id}
                      onClick={() => onOpenProject(project)}
                    >
                      <span
                        style={{
                          backgroundColor: projectMarkerColor(
                            project.name,
                            project.grade,
                          ),
                          color: markerTextColor(
                            projectMarkerColor(project.name, project.grade),
                          ),
                        }}
                      >
                        {project.grade}
                      </span>
                      <strong>{project.name}</strong>
                      <small>
                        {shortCode(project)} ·{" "}
                        {project.status === "sent" ? "Completed" : "Ongoing"}
                      </small>
                    </button>
                  );
                })}
                {!markersInView.length && (
                  <p>Pan or zoom out to find mapped lines.</p>
                )}
              </div>
            </section>
          )}
          {mode === "edit" && !quickMode && (
            <section
              className="gym-map-picker"
              aria-label="Choose a line to place"
            >
              <div className="gym-map-picker-heading">
                <div>
                  <p className="mini-label">LINE LIBRARY</p>
                  <h2>Choose by photo, not name.</h2>
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={unmappedOnly}
                    onChange={(event) => setUnmappedOnly(event.target.checked)}
                  />{" "}
                  Unmapped only
                </label>
              </div>
              <input
                className="gym-map-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search color, grade, notes or code"
                aria-label="Search lines to place"
              />
              <div className="gym-map-card-list">
                {filteredProjects.map((project) => {
                  const lineAttempts = attempts
                    .filter((attempt) => attempt.project_id === project.id)
                    .sort((a, b) => b.created_at.localeCompare(a.created_at));
                  const placed = map.markers.some(
                    (marker) => marker.project_id === project.id,
                  );
                  const selected = selectedProjectId === project.id;
                  return (
                    <button
                      type="button"
                      key={project.id}
                      className={`gym-map-line-card ${selected ? "is-selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => {
                        setCreatingAt(false);
                        setSelectedProjectId(selected ? "" : project.id);
                      }}
                    >
                      <img src={project.photo_url} alt="" />
                      <span className="gym-map-line-copy">
                        <span>
                          <strong>{project.name}</strong>
                          <em>{shortCode(project)}</em>
                        </span>
                        <small>
                          {project.status === "sent"
                            ? "Completed"
                            : project.status === "archived"
                              ? "Archived"
                              : "Ongoing"}{" "}
                          · {lineAttempts.length} attempts
                        </small>
                        <small>
                          {relativeAttemptTime(lineAttempts[0]?.created_at)}
                          {project.notes
                            ? ` · “${project.notes.slice(0, 38)}${project.notes.length > 38 ? "…" : ""}”`
                            : ""}
                        </small>
                      </span>
                      <span className="gym-map-line-state">
                        {selected ? "Place" : placed ? "Mapped" : "Choose"}
                      </span>
                    </button>
                  );
                })}
                {!filteredProjects.length && (
                  <p className="gym-map-list-empty">
                    No lines match this view.
                  </p>
                )}
              </div>
            </section>
          )}
          {mode === "edit" && (
            <div className="gym-map-list">
              <div>
                <p className="mini-label">PLACED LINES</p>
                <h2>{gym}</h2>
              </div>
              {visibleMarkers.length ? (
                visibleMarkers.map((marker, index) => {
                  const project = gymProjects.find(
                    (item) => item.id === marker.project_id,
                  );
                  if (!project) return null;
                  return (
                    <div className="gym-map-list-row" key={marker.project_id}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <button onClick={() => onOpenProject(project)}>
                        <strong>{project.name}</strong>
                        <small>
                          {shortCode(project)} ·{" "}
                          {project.status === "sent" ? "Completed" : "Ongoing"}
                        </small>
                      </button>
                      <button
                        className="gym-map-move"
                        aria-label={`Move ${project.name} on map`}
                        onClick={() => {
                          setCreatingAt(false);
                          setSelectedProjectId(project.id);
                          canvasRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                        }}
                      >
                        Move
                      </button>
                      <button
                        aria-label={`Remove ${project.name} from map`}
                        onClick={() => remove(project.id)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className="gym-map-list-empty">
                  Choose a line card, then tap its location on the map.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
