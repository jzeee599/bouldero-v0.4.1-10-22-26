"use client";
import { useEffect, useRef, useState } from "react";
import { normalize } from "@/lib/coordinates";
import type { Hold } from "@/lib/types";

type Props = {
  src: string;
  holds: Hold[];
  editable?: boolean;
  selectable?: boolean;
  selected?: string;
  onSelect?: (id: string) => void;
  onChange?: (holds: Hold[]) => void;
};
const clampScale = (value: number) => Math.max(1, Math.min(3, value));

export default function HoldMap({
  src,
  holds,
  editable = false,
  selectable = false,
  selected,
  onSelect,
  onChange,
}: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{
    id: string;
    pointer: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const pan = useRef<{
    pointer: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const interactive = editable || selectable;
  useEffect(() => {
    setReady(false);
    setFailed(false);
    setLoadAttempt(0);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);
  useEffect(() => {
    const current = image.current;
    if (!current?.complete) return;
    if (current.naturalWidth > 0) {
      setReady(true);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, [src, loadAttempt]);
  const position = (x: number, y: number) =>
    normalize(x, y, canvas.current!.getBoundingClientRect());
  const setZoom = (next: number) => {
    const nextScale = clampScale(next);
    setScale(nextScale);
    if (nextScale === 1) setOffset({ x: 0, y: 0 });
  };
  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };
  const clampOffset = (x: number, y: number) => {
    const viewport = canvas.current?.parentElement?.getBoundingClientRect();
    if (!viewport) return { x, y };
    return {
      x: Math.max(
        -(viewport.width * (scale - 1)) / 2,
        Math.min((viewport.width * (scale - 1)) / 2, x),
      ),
      y: Math.max(
        -(viewport.height * (scale - 1)) / 2,
        Math.min((viewport.height * (scale - 1)) / 2, y),
      ),
    };
  };

  return (
    <div className="photo-map-shell">
      <div
        className={`photo-map ${editable ? "is-editable" : ""} ${selectable ? "is-selectable" : ""} ${interactive ? "is-interactive" : ""}`}
        data-testid="photo-map"
        onPointerDown={(event) => {
          if (!interactive) return;
          if (event.pointerType === "mouse" && scale <= 1) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          if (pointers.current.size === 2) {
            pan.current = null;
            const [a, b] = Array.from(pointers.current.values());
            pinch.current = {
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              scale,
            };
          } else if (scale > 1) {
            pan.current = {
              pointer: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: offset.x,
              originY: offset.y,
            };
          }
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          if (pointers.current.size === 2 && pinch.current) {
            const [a, b] = Array.from(pointers.current.values());
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (Math.abs(distance - pinch.current.distance) > 3)
              suppressClick.current = true;
            setZoom(pinch.current.scale * (distance / pinch.current.distance));
            return;
          }
          if (pan.current?.pointer === event.pointerId && scale > 1) {
            const dx = event.clientX - pan.current.startX;
            const dy = event.clientY - pan.current.startY;
            if (Math.hypot(dx, dy) > 3) suppressClick.current = true;
            setOffset(
              clampOffset(pan.current.originX + dx, pan.current.originY + dy),
            );
          }
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pan.current?.pointer === event.pointerId) pan.current = null;
          if (pointers.current.size < 2) pinch.current = null;
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          pan.current = null;
          pinch.current = null;
        }}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (
            !editable ||
            !ready ||
            holds.length >= 200 ||
            event.target !== canvas.current?.querySelector("img")
          )
            return;
          onChange?.([
            ...holds.map((hold) => ({ ...hold, is_top: false })),
            {
              id: crypto.randomUUID(),
              order_index: holds.length + 1,
              ...position(event.clientX, event.clientY),
              is_top: false,
            },
          ]);
          onSelect?.("");
        }}
      >
        <div
          className="photo-map-canvas"
          data-testid="photo-map-canvas"
          ref={canvas}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`${src}-${loadAttempt}`}
            ref={image}
            src={src}
            alt="Climbing route with mapped holds"
            draggable={false}
            onLoad={() => {
              setReady(true);
              setFailed(false);
            }}
            onError={() => {
              setReady(false);
              setFailed(true);
            }}
          />
          {failed && (
            <div className="photo-load-error" role="alert">
              <p>Photo could not load.</p>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setFailed(false);
                  setReady(false);
                  setLoadAttempt((current) => current + 1);
                }}
              >
                Try again
              </button>
            </div>
          )}
          {ready &&
            holds.map((hold) => (
              <button
                key={hold.id}
                type="button"
                className={`hold ${hold.is_top ? "top-hold" : ""} ${selected === hold.id ? "selected" : ""}`}
                style={{ left: `${hold.x * 100}%`, top: `${hold.y * 100}%` }}
                aria-label={`Hold ${hold.order_index}${hold.is_top ? ", TOP" : ""}`}
                aria-pressed={
                  editable || selectable ? selected === hold.id : undefined
                }
                data-testid={`hold-${hold.order_index}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (editable || selectable) onSelect?.(hold.id);
                }}
                onPointerDown={(event) => {
                  if (!editable || pointers.current.size > 0) return;
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    id: hold.id,
                    pointer: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    moved: false,
                  };
                  onSelect?.(hold.id);
                }}
                onPointerMove={(event) => {
                  const current = drag.current;
                  if (
                    !current ||
                    current.id !== hold.id ||
                    current.pointer !== event.pointerId
                  )
                    return;
                  if (
                    Math.hypot(
                      event.clientX - current.startX,
                      event.clientY - current.startY,
                    ) > 3
                  )
                    current.moved = true;
                  if (current.moved)
                    onChange?.(
                      holds.map((item) =>
                        item.id === hold.id
                          ? {
                              ...item,
                              ...position(event.clientX, event.clientY),
                            }
                          : item,
                      ),
                    );
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onKeyDown={(event) => {
                  if (
                    !editable ||
                    ![
                      "ArrowUp",
                      "ArrowDown",
                      "ArrowLeft",
                      "ArrowRight",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const step = event.shiftKey ? 0.025 : 0.005;
                  onChange?.(
                    holds.map((item) =>
                      item.id === hold.id
                        ? {
                            ...item,
                            x: Math.max(
                              0,
                              Math.min(
                                1,
                                item.x +
                                  (event.key === "ArrowRight"
                                    ? step
                                    : event.key === "ArrowLeft"
                                      ? -step
                                      : 0),
                              ),
                            ),
                            y: Math.max(
                              0,
                              Math.min(
                                1,
                                item.y +
                                  (event.key === "ArrowDown"
                                    ? step
                                    : event.key === "ArrowUp"
                                      ? -step
                                      : 0),
                              ),
                            ),
                          }
                        : item,
                    ),
                  );
                }}
              >
                <span>{hold.is_top ? "TOP" : hold.order_index}</span>
                <i />
              </button>
            ))}
        </div>
      </div>
      {interactive && ready && (
        <div className="map-zoom" aria-label="Photo zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={scale <= 1}
            onClick={() => setZoom(scale - 0.25)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            disabled={scale === 1}
            onClick={resetView}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={scale >= 3}
            onClick={() => setZoom(scale + 0.25)}
          >
            +
          </button>
          <span>
            {scale > 1
              ? "Drag to move · pinch to zoom"
              : "Pinch the photo to zoom"}
          </span>
        </div>
      )}
    </div>
  );
}
