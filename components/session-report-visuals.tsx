"use client";

import { useState } from "react";
import type { Attempt, ClimbingSession, Project } from "@/lib/types";

type Props = {
  session: ClimbingSession;
  attempts: Attempt[];
  projects: Project[];
};
const clock = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function outcome(attempt: Attempt, project?: Project) {
  if (attempt.result === "sent")
    return attempt.topped_out ? "Wall top-out" : "Sent";
  if (project?.route_mode === "count_only") return "Attempt logged";
  if (!attempt.ended_hold_id) return "Start not established";
  const hold = project?.holds.find((hold) => hold.id === attempt.ended_hold_id);
  return `${attempt.hold_result === "touched" ? "Touched" : "Controlled"} hold ${hold?.order_index ?? "—"}`;
}

export default function SessionReportVisuals({
  session,
  attempts,
  projects,
}: Props) {
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [lineTry, setLineTry] = useState<string | null>(null);
  const ordered = [...attempts].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const ids = [...new Set(ordered.map((attempt) => attempt.project_id))];
  const warm = (attempt: Attempt) =>
    projectMap.get(attempt.project_id)?.purpose === "warm_up";
  const sends = ordered.filter(
    (attempt) => attempt.result === "sent" && !warm(attempt),
  ).length;
  const warmSends = ordered.filter(
    (attempt) => attempt.result === "sent" && warm(attempt),
  ).length;
  const start = Date.parse(session.started_at);
  const end = Date.parse(
    session.ended_at || ordered.at(-1)?.created_at || session.started_at,
  );
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  let grades = [
    ...new Set(ids.map((id) => projectMap.get(id)?.grade || "Unknown")),
  ];
  if (grades.length && grades.every((grade) => /^V\d+$/.test(grade))) {
    const maximum = Math.max(...grades.map((grade) => Number(grade.slice(1))));
    if (maximum <= 20)
      grades = Array.from({ length: maximum + 1 }, (_, index) => `V${index}`);
  } else
    grades.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const gradeRecords = (grade: string) =>
    ordered.filter(
      (attempt) =>
        (projectMap.get(attempt.project_id)?.grade || "Unknown") === grade,
    );
  const maximum = Math.max(
    1,
    ...grades.map((grade) => gradeRecords(grade).length),
  );
  const buckets = new Map<number, number>();
  const marks = ordered.map((attempt, index) => {
    const x = Math.max(
      2,
      Math.min(
        98,
        ((Date.parse(attempt.created_at) - start) / Math.max(1, end - start)) *
          100,
      ),
    );
    const bucket = Math.round(x / 8);
    const row = buckets.get(bucket) || 0;
    buckets.set(bucket, row + 1);
    return { attempt, index, x, row };
  });
  const timelineHeight = Math.max(
    180,
    ...marks.map((mark) => 60 + mark.row * 48),
  );
  const inspected = ordered.find((attempt) => attempt.id === selectedAttempt);
  const line = projectMap.get(selectedLine || "");
  const lineRecords = ordered.filter(
    (attempt) => attempt.project_id === selectedLine,
  );
  const shownRecords = lineTry
    ? lineRecords.filter((attempt) => attempt.id === lineTry)
    : lineRecords;
  const groups = new Map<string, Attempt[]>();
  shownRecords
    .filter((attempt) => attempt.ended_hold_id && !attempt.topped_out)
    .forEach((attempt) => {
      const key = `${attempt.ended_hold_id}|${attempt.hold_result || "controlled"}`;
      groups.set(key, [...(groups.get(key) || []), attempt]);
    });
  const counts = ids
    .map((id) => ({
      id,
      project: projectMap.get(id),
      records: ordered.filter((attempt) => attempt.project_id === id),
    }))
    .sort((a, b) => b.records.length - a.records.length);
  const largestLine = Math.max(1, ...counts.map((line) => line.records.length));

  return (
    <section className="report-overview" aria-label="Visual session report">
      <div className="overview-stats">
        <div>
          <strong>
            {Math.floor(minutes / 60)}h {minutes % 60}m
          </strong>
          <span>Session</span>
        </div>
        <div>
          <strong>{ids.length}</strong>
          <span>Lines</span>
        </div>
        <div>
          <strong>{ordered.length}</strong>
          <span>Attempts incl. sends</span>
        </div>
        <div>
          <strong>{sends}</strong>
          <span>Non-warm-up sends</span>
        </div>
      </div>
      {warmSends > 0 && (
        <p className="overview-warm-note">
          {warmSends} warm-up send{warmSends === 1 ? "" : "s"} · counted
          separately
        </p>
      )}
      {!ordered.length ? (
        <p>No activity recorded in this session.</p>
      ) : (
        <>
          <div className="overview-chart-grid">
            <section className="overview-chart">
              <h3>Difficulty distribution</h3>
              <div className="overview-legend">
                <span>● Attempt</span>
                <span>✓ Send</span>
                <span>◌ Warm-up record</span>
              </div>
              <div className="overview-grade-scroll">
                <div
                  className="overview-grade-chart"
                  style={{ minWidth: grades.length * 44 }}
                >
                  {grades.map((grade) => {
                    const records = gradeRecords(grade);
                    const warmCount = records.filter(warm).length;
                    const sentCount = records.filter(
                      (attempt) => attempt.result === "sent" && !warm(attempt),
                    ).length;
                    return (
                      <div className="overview-grade-column" key={grade}>
                        <strong>{records.length}</strong>
                        <div className="overview-grade-stack">
                          {[
                            ["sent", sentCount],
                            ["attempt", records.length - warmCount - sentCount],
                            ["warm", warmCount],
                          ].map(
                            ([kind, count]) =>
                              Number(count) > 0 && (
                                <div
                                  key={kind}
                                  className={`overview-grade-segment ${kind}`}
                                  style={{
                                    height: (Number(count) / maximum) * 170,
                                  }}
                                />
                              ),
                          )}
                        </div>
                        <button
                          aria-pressed={selectedGrade === grade}
                          onClick={() => setSelectedGrade(grade)}
                          aria-label={`Inspect ${grade}: ${records.length} records`}
                        >
                          {grade}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              {selectedGrade && (
                <p className="overview-insight" aria-live="polite">
                  {selectedGrade} ·{" "}
                  {
                    new Set(
                      gradeRecords(selectedGrade).map(
                        (attempt) => attempt.project_id,
                      ),
                    ).size
                  }{" "}
                  lines · {gradeRecords(selectedGrade).length} records ·{" "}
                  {
                    gradeRecords(selectedGrade).filter(
                      (attempt) => attempt.result === "sent",
                    ).length
                  }{" "}
                  sends including warm-ups
                </p>
              )}
              <p className="overview-caption">
                Height = recorded attempts. Sends are included.
              </p>
            </section>
            <section className="overview-chart">
              <h3>Whole-session timeline</h3>
              <div
                className="overview-time-chart"
                style={{ height: timelineHeight }}
              >
                <div className="overview-time-grid" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                {marks.map(({ attempt, index, x, row }) => (
                  <button
                    key={attempt.id}
                    className={`overview-time-mark ${warm(attempt) ? "warm" : attempt.result === "sent" ? "sent" : ""}`}
                    style={{ left: `${x}%`, bottom: 12 + row * 48 }}
                    onClick={() => setSelectedAttempt(attempt.id)}
                    aria-label={`Record ${index + 1}: ${projectMap.get(attempt.project_id)?.name || "Deleted line"}, ${clock(attempt.created_at)}, ${outcome(attempt, projectMap.get(attempt.project_id))}`}
                  >
                    {attempt.result === "sent" ? "✓" : index + 1}
                  </button>
                ))}
              </div>
              <div className="overview-time-axis">
                <span>{clock(session.started_at)}</span>
                <span>{clock(session.ended_at || session.started_at)}</span>
              </div>
              <label className="overview-record-select">
                Inspect a record
                <select
                  value={selectedAttempt || ""}
                  onChange={(event) =>
                    setSelectedAttempt(event.target.value || null)
                  }
                >
                  <option value="">Choose a record</option>
                  {ordered.map((attempt, index) => (
                    <option key={attempt.id} value={attempt.id}>
                      {index + 1} ·{" "}
                      {projectMap.get(attempt.project_id)?.name ||
                        "Deleted line"}{" "}
                      · {clock(attempt.created_at)}
                    </option>
                  ))}
                </select>
              </label>
              {inspected && (
                <p className="overview-insight" aria-live="polite">
                  {projectMap.get(inspected.project_id)?.name || "Deleted line"}{" "}
                  · {clock(inspected.created_at)} ·{" "}
                  {outcome(inspected, projectMap.get(inspected.project_id))}
                  {inspected.notes && ` · ${inspected.notes}`}
                </p>
              )}
              <p className="overview-caption">
                X = logged time. Rows separate close records. Gaps are not
                assumed rest.
              </p>
            </section>
          </div>
          <section className="overview-chart">
            <h3>Where your attempts went</h3>
            <p className="overview-caption">
              Bar length = attempts. Select a line for its photo and hold
              endpoints.
            </p>
            {counts.map(({ id, project, records }) => (
              <button
                className="overview-line-bar"
                key={id}
                onClick={() => {
                  setSelectedLine(id);
                  setLineTry(null);
                }}
                aria-expanded={selectedLine === id}
                aria-label={`Review ${project?.name || "Deleted line"}, ${records.length} attempts`}
              >
                {project && !project.photo_optional ? (
                  <img src={project.photo_url} alt="" loading="lazy" />
                ) : (
                  <span className="overview-photo-placeholder">—</span>
                )}
                <span>{project?.name || "Deleted line"}</span>
                <div className="overview-line-track">
                  <i
                    style={{
                      width: `${(records.length / largestLine) * 100}%`,
                    }}
                  />
                </div>
                <strong>{records.length}</strong>
              </button>
            ))}
          </section>
          {line && (
            <section
              className="overview-line-review"
              aria-label="Line endpoint review"
            >
              <div className="overview-line-heading">
                <h3>{line.name}</h3>
                <button onClick={() => setSelectedLine(null)}>
                  Close review
                </button>
              </div>
              <label className="overview-record-select">
                Line attempts
                <select
                  value={lineTry || ""}
                  onChange={(event) => setLineTry(event.target.value || null)}
                >
                  <option value="">All endpoints</option>
                  {lineRecords.map((attempt, index) => (
                    <option key={attempt.id} value={attempt.id}>
                      Try {index + 1} · {outcome(attempt, line)}
                    </option>
                  ))}
                </select>
              </label>
              {!line.photo_optional && (
                <div className="overview-route-photo">
                  <img src={line.photo_url} alt={`${line.name} route`} />
                  {line.holds.map((hold) => (
                    <span
                      className="overview-hold-label"
                      key={hold.id}
                      style={{
                        left: `${hold.x * 100}%`,
                        top: `${hold.y * 100}%`,
                      }}
                    >
                      {hold.order_index}
                    </span>
                  ))}
                  {[...groups.entries()].map(([key, records]) => {
                    const hold = line.holds.find(
                      (hold) => hold.id === records[0].ended_hold_id,
                    );
                    return (
                      hold && (
                        <button
                          key={key}
                          className={`overview-endpoint ${records[0].hold_result === "touched" ? "touched" : ""}`}
                          style={{
                            left: `${hold.x * 100}%`,
                            top: `${hold.y * 100}%`,
                          }}
                          onClick={() => setLineTry(records[0].id)}
                          aria-label={`${records.length} ${records[0].hold_result === "touched" ? "touched" : "controlled"} endpoints at hold ${hold.order_index}`}
                        >
                          {records.length}
                        </button>
                      )
                    );
                  })}
                </div>
              )}
              <div className="overview-review-results">
                {shownRecords.map((attempt) => (
                  <p key={attempt.id}>
                    {clock(attempt.created_at)} · {outcome(attempt, line)}
                    {attempt.started_hold_id &&
                      ` · Started at hold ${line.holds.find((hold) => hold.id === attempt.started_hold_id)?.order_index ?? "—"}`}
                    {attempt.notes && ` · ${attempt.notes}`}
                  </p>
                ))}
              </div>
              <p className="overview-caption">
                Photo markers count recorded endpoints, not moves climbed.
                Touched endpoints use an outline. Send and wall top-out remain
                explicit results.
              </p>
            </section>
          )}
        </>
      )}
      <details className="overview-definitions">
        <summary>Data definitions</summary>
        <p>
          Send totals are events, not distinct completed lines. Warm-ups are
          separated. Batch logging may share timestamps. Current route grades,
          purposes, photos and hold maps are used. Missing endpoints are not
          estimated.
        </p>
      </details>
    </section>
  );
}
