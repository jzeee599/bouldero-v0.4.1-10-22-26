import { cloudEnabled, cloudOwner, supabase } from "./cloud-client";
export { cloudEnabled } from "./cloud-client";
import type { Attempt, ClimbingSession, GymMap, Project } from "./types";

type StoredProject = Project & { photo?: Blob };
type StoredGymMap = GymMap & { image?: Blob };
type BackupProject = Omit<StoredProject, "photo"> & {
  photo_data: string | null;
};
type BackupGymMap = Omit<StoredGymMap, "image"> & {
  image_data: string | null;
};
type BoulderoBackup = {
  kind: "bouldero-backup";
  version: 2;
  exported_at: string;
  projects: BackupProject[];
  sessions: ClimbingSession[];
  attempts: Attempt[];
  gym_maps: BackupGymMap[];
  gym_grade_systems?: Record<string, string>;
};
export type ImportSummary = {
  projects: number;
  sessions: number;
  attempts: number;
  gym_maps: number;
  preview?: { added: number; replaced: number; label: string }[];
};

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("bouldero-v1", 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("projects"))
        db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sessions"))
        db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("attempts"))
        db.createObjectStore("attempts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("gym_maps"))
        db.createObjectStore("gym_maps", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Local storage is unavailable. Check your browser storage settings.",
        ),
      );
  });
}
async function localRequest<T>(
  storeName: "projects" | "sessions" | "attempts" | "gym_maps",
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    let request: IDBRequest<T>;
    try {
      request = action(transaction.objectStore(storeName));
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    // Report success only when the transaction is durably committed.
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = transaction.onabort = () => {
      db.close();
      reject(
        new Error(
          "Could not save locally. Your browser may be out of storage.",
        ),
      );
    };
  });
}
const owner = cloudOwner;
export async function listProjects(): Promise<Project[]> {
  if (!supabase) {
    const rows = await localRequest<StoredProject[]>(
      "projects",
      "readonly",
      (store) => store.getAll(),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const photoFor = (
      row: StoredProject,
      seen = new Set<string>(),
    ): Blob | null => {
      if (seen.has(row.id))
        throw new Error(`Circular photo reference for ${row.name}.`);
      seen.add(row.id);
      if (row.photo_optional && !row.photo && !row.source_project_id)
        return null;
      if (row.photo) return row.photo;
      const source = row.source_project_id && byId.get(row.source_project_id);
      if (!source) throw new Error(`Photo source missing for ${row.name}.`);
      return photoFor(source, seen);
    };
    return rows
      .map(({ photo: _photo, ...project }) => ({
        ...project,
        route_mode: project.route_mode || "mapped",
        source_project_id: project.source_project_id || null,
        finish_type: project.finish_type || "hold",
        notes: project.notes || "",
        purpose: project.purpose || "project",
        photo_url: (() => {
          const photo = photoFor(byId.get(project.id)!);
          return photo ? URL.createObjectURL(photo) : "/no-photo.svg";
        })(),
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  await owner();
  const data = await cloudRows<Project>(
    "projects",
    "*, holds(*)",
    "created_at",
  );
  return Promise.all(
    data.map(async (row) => {
      const photoUrl = row.photo_url
        ? await signedImage(row.photo_url)
        : "/no-photo.svg";
      return {
        ...row,
        grade: row.grade || "",
        gym: row.gym || "",
        route_mode: row.route_mode || "mapped",
        source_project_id: row.source_project_id || null,
        finish_type: row.finish_type || "hold",
        notes: row.notes || "",
        purpose: row.purpose || "project",
        photo_url: photoUrl,
        storage_photo_path: row.photo_url || null,
        holds: row.holds.sort(
          (a: Project["holds"][number], b: Project["holds"][number]) =>
            a.order_index - b.order_index,
        ),
      } as Project;
    }),
  );
}

export async function listGymMaps(): Promise<GymMap[]> {
  if (supabase) {
    await owner();
    const rows = await cloudRows<GymMap>("gym_maps", "*", "updated_at");
    return Promise.all(
      rows.map(
        async (row) =>
          ({
            ...row,
            storage_image_path: row.image_url,
            image_url: row.image_url.startsWith("/gym-maps/cleaned/")
              ? row.image_url
              : await signedImage(row.image_url),
          }) as GymMap,
      ),
    );
  }
  const rows = await localRequest<StoredGymMap[]>(
    "gym_maps",
    "readonly",
    (store) => store.getAll(),
  );
  return rows
    .map(({ image, ...map }) => ({
      ...map,
      markers: map.markers || [],
      image_url: image ? URL.createObjectURL(image) : map.image_url || "",
    }))
    .sort((a, b) => a.gym.localeCompare(b.gym));
}

export async function saveGymMap(map: GymMap, image?: Blob): Promise<GymMap> {
  if (supabase) {
    const id = await owner();
    const uploaded: string[] = [];
    try {
      const path = image
        ? await uploadImage(id, map.id, image, uploaded)
        : map.storage_image_path || map.image_url;
      await commitWorkspace({ maps: [{ ...map, image_url: path }] });
      return {
        ...map,
        storage_image_path: path,
        image_url: path.startsWith("/gym-maps/cleaned/")
          ? path
          : await signedImage(path),
      };
    } catch (error) {
      await removeUploads(uploaded);
      throw error;
    }
  }
  await localRequest("gym_maps", "readwrite", (store) => {
    const request = store.get(map.id) as IDBRequest<StoredGymMap>;
    request.onsuccess = () => {
      const savedImage = request.result?.image;
      const usesBundledImage =
        Boolean(map.image_url) && !map.image_url.startsWith("blob:");
      store.put({
        ...map,
        image_url:
          image || (!usesBundledImage && savedImage) ? "" : map.image_url,
        ...(image
          ? { image }
          : !usesBundledImage && savedImage
            ? { image: savedImage }
            : {}),
      });
    };
    return request;
  });
  return map;
}
export async function saveProject(
  project: Project,
  photo: Blob | null,
): Promise<void> {
  if (!supabase) {
    await localRequest("projects", "readwrite", (store) =>
      store.put({ ...project, photo_url: "", ...(photo ? { photo } : {}) }),
    );
    return;
  }
  const userId = await owner();
  const uploaded: string[] = [];
  try {
    let path: string | null = null;
    if (photo) path = await uploadImage(userId, project.id, photo, uploaded);
    else if (project.source_project_id) {
      const { data, error } = await supabase
        .from("projects")
        .select("photo_url")
        .eq("id", project.source_project_id)
        .single();
      if (error) throw error;
      path = data.photo_url;
    }
    await commitWorkspace({
      projects: [{ ...project, storage_photo_path: path }],
    });
  } catch (error) {
    await removeUploads(uploaded);
    throw error;
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("A saved photo could not be included in the backup."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(value: string) {
  const match = /^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/.exec(value);
  if (!match) throw new Error("This backup contains an invalid photo.");
  const bytes = Uint8Array.from(atob(match[2]), (character) =>
    character.charCodeAt(0),
  );
  return new Blob([bytes], { type: match[1] || "application/octet-stream" });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function exportLocalData(): Promise<Blob> {
  if (supabase) {
    const [projects, sessions, attempts, maps] = await Promise.all([
      listProjects(),
      listSessions(),
      listAttempts(),
      listGymMaps(),
    ]);
    const backupProjects = [];
    for (const project of projects) {
      const { storage_photo_path: _path, ...row } = project;
      backupProjects.push({
        ...row,
        photo_url: "",
        photo_data: project.photo_optional
          ? null
          : await imageData(project.photo_url),
      });
    }
    const gymMaps = [];
    for (const map of maps) {
      const { storage_image_path: _path, ...row } = map;
      gymMaps.push({
        ...row,
        image_url: "",
        image_data: await imageData(map.image_url),
      });
    }
    const backup: BoulderoBackup = {
      kind: "bouldero-backup",
      version: 2,
      exported_at: new Date().toISOString(),
      projects: backupProjects,
      sessions,
      attempts,
      gym_maps: gymMaps,
      gym_grade_systems: await loadCloudPreferences(),
    };
    return new Blob([JSON.stringify(backup)], { type: "application/json" });
  }
  const [projects, sessions, attempts, gymMaps] = await Promise.all([
    localRequest<StoredProject[]>("projects", "readonly", (store) =>
      store.getAll(),
    ),
    localRequest<ClimbingSession[]>("sessions", "readonly", (store) =>
      store.getAll(),
    ),
    localRequest<Attempt[]>("attempts", "readonly", (store) => store.getAll()),
    localRequest<StoredGymMap[]>("gym_maps", "readonly", (store) =>
      store.getAll(),
    ),
  ]);
  const backupProjects = await Promise.all(
    projects.map(async ({ photo, ...project }) => ({
      ...project,
      notes: project.notes || "",
      purpose: project.purpose || "project",
      photo_data: photo ? await blobToDataUrl(photo) : null,
    })),
  );
  const backup: BoulderoBackup = {
    kind: "bouldero-backup",
    version: 2,
    exported_at: new Date().toISOString(),
    gym_grade_systems: Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith("bouldero-grade:"))
        .map((key) => [key, localStorage.getItem(key)!]),
    ),
    projects: backupProjects,
    sessions,
    attempts,
    gym_maps: await Promise.all(
      gymMaps.map(async ({ image, ...map }) => ({
        ...map,
        image_data: image ? await blobToDataUrl(image) : null,
      })),
    ),
  };
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

export async function updateProjectDetails(
  project: Project,
  replacementPhoto?: Blob | null,
): Promise<void> {
  if (!supabase) {
    await localRequest("projects", "readwrite", (store) => {
      const request = store.get(project.id) as IDBRequest<StoredProject>;
      request.onsuccess = () => {
        if (!request.result) {
          store.transaction.abort();
          return;
        }
        const { photo: savedPhoto, ...savedProject } = request.result;
        store.put({
          ...savedProject,
          ...project,
          photo_url: "",
          ...(replacementPhoto === undefined && savedPhoto
            ? { photo: savedPhoto }
            : replacementPhoto
              ? { photo: replacementPhoto }
              : {}),
        });
      };
      return request;
    });
    return;
  }
  const userId = await owner();
  const uploaded: string[] = [];
  try {
    const path = replacementPhoto
      ? await uploadImage(userId, project.id, replacementPhoto, uploaded)
      : replacementPhoto === null
        ? null
        : project.storage_photo_path || null;
    await commitWorkspace({
      projects: [{ ...project, storage_photo_path: path }],
    });
  } catch (error) {
    await removeUploads(uploaded);
    throw error;
  }
}

export async function importLocalData(
  file: File,
  onProgress?: (message: string) => void,
  previewOnly = false,
): Promise<ImportSummary> {
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error("Choose a valid Bouldero backup file.");
  }
  if (
    !isObject(value) ||
    value.kind !== "bouldero-backup" ||
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.attempts)
  ) {
    throw new Error("This file is not a supported Bouldero backup.");
  }
  const requireId = (item: unknown, label: string) => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id) {
      throw new Error(`This backup contains an invalid ${label}.`);
    }
    return item;
  };
  const projects = value.projects.map((item) => {
    const row = requireId(item, "line");
    if (
      !Array.isArray(row.holds) ||
      typeof row.name !== "string" ||
      (row.photo_data !== null && typeof row.photo_data !== "string")
    ) {
      throw new Error("This backup contains an invalid line.");
    }
    const { photo_data, ...project } = row as unknown as BackupProject;
    return {
      ...project,
      notes: project.notes || "",
      purpose: project.purpose || "project",
      ...(photo_data ? { photo: dataUrlToBlob(photo_data) } : {}),
    } as StoredProject;
  });
  const sessions = value.sessions.map(
    (item) => requireId(item, "session") as unknown as ClimbingSession,
  );
  const attempts = value.attempts.map((item) => {
    const attempt = requireId(item, "attempt") as unknown as Attempt;
    return {
      ...attempt,
      hold_result:
        attempt.hold_result || (attempt.ended_hold_id ? "controlled" : null),
    };
  });
  const gymMaps = (Array.isArray(value.gym_maps) ? value.gym_maps : []).map(
    (item) => {
      const row = requireId(item, "gym map");
      if (
        !Array.isArray(row.markers) ||
        (row.image_data !== null && typeof row.image_data !== "string")
      )
        throw new Error("This backup contains an invalid gym map.");
      const { image_data, ...map } = row as unknown as BackupGymMap;
      return {
        ...map,
        markers: map.markers || [],
        ...(image_data ? { image: dataUrlToBlob(image_data) } : {}),
      } as StoredGymMap;
    },
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const sessionIds = new Set(sessions.map((session) => session.id));
  if (
    projects.some(
      (project) =>
        !project.photo &&
        !project.photo_optional &&
        (!project.source_project_id ||
          !projectIds.has(project.source_project_id)),
    )
  ) {
    throw new Error(
      "This backup is missing a photo used by one or more lines.",
    );
  }
  if (
    attempts.some(
      (attempt) =>
        !projectIds.has(attempt.project_id) ||
        !sessionIds.has(attempt.session_id),
    )
  ) {
    throw new Error(
      "This backup contains an attempt whose line or session is missing.",
    );
  }
  const collections = [projects, sessions, attempts, gymMaps];
  if (
    collections.some(
      (rows) => new Set(rows.map((row) => row.id)).size !== rows.length,
    )
  )
    throw new Error(
      "This backup contains duplicate record IDs. Nothing was imported.",
    );
  if (previewOnly) {
    const stores = ["projects", "sessions", "attempts", "gym_maps"] as const;
    const existing = await Promise.all(
      stores.map(async (store) => {
        if (!supabase)
          return new Set(
            await localRequest(store, "readonly", (s) => s.getAllKeys()),
          );
        const { data, error } = await supabase
          .from(store === "sessions" ? "climbing_sessions" : store)
          .select("id");
        if (error) throw error;
        return new Set((data || []).map((row) => row.id));
      }),
    );
    return {
      projects: projects.length,
      sessions: sessions.length,
      attempts: attempts.length,
      gym_maps: gymMaps.length,
      preview: collections.map((rows, index) => {
        const replaced = rows.filter((row) =>
          existing[index].has(row.id),
        ).length;
        return {
          label: ["Lines", "Sessions", "Attempts", "Gym maps"][index],
          added: rows.length - replaced,
          replaced,
        };
      }),
    };
  }
  if (supabase) {
    const userId = await owner();
    const uploaded: string[] = [];
    try {
      const totalImages =
        projects.filter((project) => project.photo).length +
        gymMaps.filter((map) => map.image).length;
      let completedImages = 0;
      const byId = new Map(projects.map((project) => [project.id, project]));
      const paths = new Map<string, string | null>();
      const visiting = new Set<string>();
      async function pathFor(project: StoredProject): Promise<string | null> {
        if (paths.has(project.id)) return paths.get(project.id)!;
        if (visiting.has(project.id))
          throw new Error("Circular photo reference in backup.");
        visiting.add(project.id);
        const source =
          project.source_project_id && byId.get(project.source_project_id);
        const path = project.photo
          ? await uploadImage(userId, project.id, project.photo, uploaded)
          : source
            ? await pathFor(source)
            : null;
        if (project.photo)
          onProgress?.(
            `Uploading photos: ${++completedImages} / ${totalImages}`,
          );
        paths.set(project.id, path);
        visiting.delete(project.id);
        return path;
      }
      const cloudProjects = [];
      for (const project of projects) {
        const { photo: _photo, ...row } = project;
        cloudProjects.push({
          ...row,
          storage_photo_path: await pathFor(project),
        });
      }
      const cloudMaps = [];
      for (const map of gymMaps) {
        const { image, ...row } = map;
        if (image)
          onProgress?.(
            `Uploading photos: ${++completedImages} / ${totalImages}`,
          );
        cloudMaps.push({
          ...row,
          image_url: image
            ? await uploadImage(userId, map.id, image, uploaded)
            : map.image_url,
        });
      }
      const grades = validGradePreferences(value.gym_grade_systems);
      onProgress?.("Saving lines, sessions, attempts and maps…");
      await commitWorkspace({
        projects: cloudProjects,
        sessions,
        attempts,
        maps: cloudMaps,
        grades,
      });
      Object.entries(grades).forEach(([key, value]) =>
        localStorage.setItem(key, value),
      );
      return {
        projects: projects.length,
        sessions: sessions.length,
        attempts: attempts.length,
        gym_maps: gymMaps.length,
      };
    } catch (error) {
      await removeUploads(uploaded);
      throw error;
    }
  }
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(
      ["projects", "sessions", "attempts", "gym_maps"],
      "readwrite",
    );
    projects.forEach((project) =>
      transaction.objectStore("projects").put(project),
    );
    sessions.forEach((session) =>
      transaction.objectStore("sessions").put(session),
    );
    attempts.forEach((attempt) =>
      transaction.objectStore("attempts").put(attempt),
    );
    gymMaps.forEach((map) => transaction.objectStore("gym_maps").put(map));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = transaction.onabort = () => {
      db.close();
      reject(
        new Error(
          "The backup could not be imported. Your current data was not changed.",
        ),
      );
    };
  });
  if (isObject(value.gym_grade_systems)) {
    Object.entries(value.gym_grade_systems).forEach(([key, value]) => {
      if (
        key.startsWith("bouldero-grade:") &&
        (value === "V" || value === "Font" || value === "Custom")
      )
        localStorage.setItem(key, value);
    });
  }
  return {
    projects: projects.length,
    sessions: sessions.length,
    attempts: attempts.length,
    gym_maps: gymMaps.length,
  };
}

export async function updateProjectStatus(
  project: Project,
  status: Project["status"],
): Promise<Project> {
  const updated: Project = {
    ...project,
    status,
    sent_at:
      status === "sent" ? project.sent_at || new Date().toISOString() : null,
  };
  if (!supabase) {
    await localRequest("projects", "readwrite", (store) => {
      const request = store.get(project.id) as IDBRequest<StoredProject>;
      request.onsuccess = () => {
        if (!request.result) {
          store.transaction.abort();
          return;
        }
        store.put({
          ...request.result,
          status: updated.status,
          sent_at: updated.sent_at,
        });
      };
      return request;
    });
    return updated;
  }
  await owner();
  const { error } = await supabase
    .from("projects")
    .update({ status: updated.status, sent_at: updated.sent_at })
    .eq("id", project.id);
  if (error) throw error;
  return updated;
}

export async function listSessions(): Promise<ClimbingSession[]> {
  if (!supabase) {
    const rows = await localRequest<ClimbingSession[]>(
      "sessions",
      "readonly",
      (store) => store.getAll(),
    );
    return rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
  }
  await owner();
  return (await cloudRows<ClimbingSession>(
    "climbing_sessions",
    "id,gym,started_at,ended_at",
    "started_at",
  )) as ClimbingSession[];
}

export async function startSession(
  gym: string,
  timing?: { startedAt: string; endedAt: string },
): Promise<ClimbingSession> {
  const session: ClimbingSession = {
    id: crypto.randomUUID(),
    gym: gym.trim(),
    started_at: timing?.startedAt || new Date().toISOString(),
    ended_at: timing?.endedAt || null,
  };
  if (!supabase) {
    await localRequest("sessions", "readwrite", (store) => store.put(session));
    return session;
  }
  const userId = await owner();
  const { data, error } = await supabase
    .from("climbing_sessions")
    .insert({ ...session, user_id: userId })
    .select("id,gym,started_at,ended_at")
    .single();
  if (error) throw error;
  return data as ClimbingSession;
}

export async function endSession(
  session: ClimbingSession,
): Promise<ClimbingSession> {
  const ended = { ...session, ended_at: new Date().toISOString() };
  if (!supabase) {
    await localRequest("sessions", "readwrite", (store) => store.put(ended));
    return ended;
  }
  const { data, error } = await supabase
    .from("climbing_sessions")
    .update({ ended_at: ended.ended_at })
    .eq("id", session.id)
    .select("id,gym,started_at,ended_at")
    .single();
  if (error) throw error;
  return data as ClimbingSession;
}

export async function updateSessionDetails(
  session: ClimbingSession,
): Promise<ClimbingSession> {
  const updated = { ...session, gym: session.gym.trim() };
  if (!supabase) {
    await localRequest("sessions", "readwrite", (store) => store.put(updated));
    return updated;
  }
  const { data, error } = await supabase
    .from("climbing_sessions")
    .update({
      gym: updated.gym,
      started_at: updated.started_at,
      ended_at: updated.ended_at,
    })
    .eq("id", updated.id)
    .select("id,gym,started_at,ended_at")
    .single();
  if (error) throw error;
  return data as ClimbingSession;
}

export async function listAttempts(): Promise<Attempt[]> {
  if (!supabase) {
    const rows = await localRequest<Attempt[]>(
      "attempts",
      "readonly",
      (store) => store.getAll(),
    );
    return rows
      .map((attempt) => ({
        ...attempt,
        started_hold_id: attempt.started_hold_id || null,
        ended_hold_id: attempt.ended_hold_id || null,
        hold_result:
          attempt.hold_result || (attempt.ended_hold_id ? "controlled" : null),
        topped_out: Boolean(attempt.topped_out),
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  await owner();
  return (await cloudRows<Attempt>(
    "attempts",
    "id,project_id,session_id,result,started_hold_id,ended_hold_id,hold_result,topped_out,notes,created_at",
    "created_at",
  )) as Attempt[];
}

export async function saveAttempt(attempt: Attempt): Promise<void> {
  await saveAttempts([attempt]);
}

export async function saveAttempts(attempts: Attempt[]): Promise<void> {
  if (!attempts.length) return;
  if (!supabase) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("attempts", "readwrite");
      const store = transaction.objectStore("attempts");
      attempts.forEach((attempt) => store.put(attempt));
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = transaction.onabort = () => {
        db.close();
        reject(new Error("Could not save attempts locally."));
      };
    });
    return;
  }
  const userId = await owner();
  const { error } = await supabase
    .from("attempts")
    .insert(attempts.map((attempt) => ({ ...attempt, user_id: userId })));
  if (error) throw error;
}

export async function updateAttemptNotes(
  attempt: Attempt,
  notes: string,
): Promise<Attempt> {
  const updated = { ...attempt, notes: notes.trim() };
  if (!supabase) {
    await localRequest("attempts", "readwrite", (store) => store.put(updated));
    return updated;
  }
  const { error } = await supabase
    .from("attempts")
    .update({ notes: updated.notes })
    .eq("id", attempt.id);
  if (error) throw error;
  return updated;
}

export async function updateAttemptDetails(attempt: Attempt): Promise<Attempt> {
  const updated = { ...attempt, notes: attempt.notes.trim() };
  if (!supabase) {
    await localRequest("attempts", "readwrite", (store) => store.put(updated));
    return updated;
  }
  const { error } = await supabase
    .from("attempts")
    .update({
      result: updated.result,
      started_hold_id: updated.started_hold_id,
      ended_hold_id: updated.ended_hold_id,
      hold_result: updated.hold_result,
      topped_out: updated.topped_out,
      notes: updated.notes,
      created_at: updated.created_at,
    })
    .eq("id", attempt.id);
  if (error) throw error;
  return updated;
}

export async function deleteProject(projectId: string): Promise<void> {
  if (!supabase) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ["projects", "attempts", "gym_maps"],
        "readwrite",
      );
      const projectsStore = transaction.objectStore("projects");
      const attemptsStore = transaction.objectStore("attempts");
      const mapsStore = transaction.objectStore("gym_maps");
      let sourcePhoto: Blob | undefined;

      const projectRequest = projectsStore.get(
        projectId,
      ) as IDBRequest<StoredProject>;
      projectRequest.onsuccess = () => {
        sourcePhoto = projectRequest.result?.photo;
        projectsStore.delete(projectId);

        const projectsCursor = projectsStore.openCursor();
        projectsCursor.onsuccess = () => {
          const cursor = projectsCursor.result;
          if (!cursor) return;
          const project = cursor.value as StoredProject;
          if (project.source_project_id === projectId) {
            cursor.update({
              ...project,
              source_project_id: null,
              ...(project.photo
                ? {}
                : sourcePhoto
                  ? { photo: sourcePhoto }
                  : {}),
            });
          }
          cursor.continue();
        };
      };

      const attemptsCursor = attemptsStore.openCursor();
      attemptsCursor.onsuccess = () => {
        const cursor = attemptsCursor.result;
        if (!cursor) return;
        if ((cursor.value as Attempt).project_id === projectId) cursor.delete();
        cursor.continue();
      };

      const mapsCursor = mapsStore.openCursor();
      mapsCursor.onsuccess = () => {
        const cursor = mapsCursor.result;
        if (!cursor) return;
        const map = cursor.value as StoredGymMap;
        const markers = (map.markers || []).filter(
          (marker) => marker.project_id !== projectId,
        );
        if (markers.length !== (map.markers || []).length) {
          cursor.update({
            ...map,
            markers,
            updated_at: new Date().toISOString(),
          });
        }
        cursor.continue();
      };

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = transaction.onabort = () => {
        db.close();
        reject(new Error("Could not delete this line."));
      };
    });
    return;
  }

  await owner();
  const { data: project, error: readError } = await supabase
    .from("projects")
    .select("photo_url")
    .eq("id", projectId)
    .single();
  if (readError) throw readError;

  // Reused lines already point at the same stored image. Detach them first so
  // the self-reference constraint does not prevent deleting the source line.
  const { error: detachError } = await supabase
    .from("projects")
    .update({ source_project_id: null })
    .eq("source_project_id", projectId);
  if (detachError) throw detachError;

  const { error: deleteError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);
  if (deleteError) throw deleteError;

  const { count, error: countError } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("photo_url", project.photo_url);
  if (countError) throw countError;
  if (!count && project.photo_url) {
    const { error: photoError } = await supabase.storage
      .from("project-photos")
      .remove([project.photo_url]);
    if (photoError) throw photoError;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (!supabase) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["sessions", "attempts"], "readwrite");
      transaction.objectStore("sessions").delete(sessionId);
      const attemptsStore = transaction.objectStore("attempts");
      const cursor = attemptsStore.openCursor();
      cursor.onsuccess = () => {
        const result = cursor.result;
        if (!result) return;
        if ((result.value as Attempt).session_id === sessionId) result.delete();
        result.continue();
      };
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = transaction.onabort = () => {
        db.close();
        reject(new Error("Could not delete this session."));
      };
    });
    return;
  }
  await owner();
  const { error } = await supabase
    .from("climbing_sessions")
    .delete()
    .eq("id", sessionId);
  if (error) throw error;
}

// Commit quick-log route, attempts and completion together in device storage.
export async function saveQuickClimb(
  project: Project,
  batch: Attempt[],
  complete: boolean,
  isNew: boolean,
): Promise<void> {
  if (supabase) {
    await owner();
    const updated = complete
      ? {
          ...project,
          status: "sent" as const,
          sent_at:
            project.sent_at ||
            batch.at(-1)?.created_at ||
            new Date().toISOString(),
        }
      : project;
    if (isNew) {
      const { data, error } = await supabase
        .from("projects")
        .select("id")
        .eq("id", project.id)
        .maybeSingle();
      if (error) throw error;
      if (data) throw new Error("This line already exists.");
    }
    await commitWorkspace({ projects: [updated], attempts: batch });
    return;
  }
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["projects", "attempts"], "readwrite");
    const store = tx.objectStore("projects");
    const request = store.get(project.id) as IDBRequest<StoredProject>;
    request.onsuccess = () => {
      const row = request.result;
      if ((!isNew && !row) || (isNew && row)) {
        tx.abort();
        return;
      }
      const saved = row || { ...project, photo_url: "" };
      store.put(
        complete
          ? {
              ...saved,
              status: "sent",
              sent_at: saved.sent_at || batch.at(-1)?.created_at,
            }
          : saved,
      );
      batch.forEach((attempt) => tx.objectStore("attempts").add(attempt));
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        new Error(
          "Could not save this climb. Nothing was added; please retry.",
        ),
      );
    };
  });
}

async function cloudRows<T extends object>(
  table: string,
  select: string,
  order: string,
) {
  if (!supabase) throw new Error("Cloud storage is not configured.");
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(order, { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data as unknown as T[]));
    if (data.length < 500) return rows;
  }
}
async function signedImage(path: string) {
  const { data, error } = await supabase!.storage
    .from("project-photos")
    .createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
async function uploadImage(
  userId: string,
  id: string,
  image: Blob,
  uploaded: string[],
) {
  const type = image.type || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp"].includes(type))
    throw new Error("Cloud images must be JPEG, PNG or WebP.");
  if (image.size > 10 * 1024 * 1024)
    throw new Error("Cloud images must be smaller than 10 MB.");
  const path = `${userId}/${id}-${crypto.randomUUID()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
  const { error } = await supabase!.storage
    .from("project-photos")
    .upload(path, image, { contentType: type, upsert: false });
  if (error) throw error;
  uploaded.push(path);
  return path;
}
async function removeUploads(paths: string[]) {
  if (paths.length && supabase) {
    const { error } = await supabase.storage
      .from("project-photos")
      .remove(paths);
    if (error)
      console.error(
        "Unlinked cloud uploads could not be removed:",
        error.message,
      );
  }
}
async function commitWorkspace(input: {
  projects?: Project[];
  sessions?: ClimbingSession[];
  attempts?: Attempt[];
  maps?: GymMap[];
  grades?: Record<string, string>;
}) {
  await owner();
  const { error } = await supabase!.rpc("commit_workspace", {
    p_projects: input.projects || [],
    p_sessions: input.sessions || [],
    p_attempts: input.attempts || [],
    p_maps: input.maps || [],
    p_grades: input.grades || null,
  });
  if (error)
    throw new Error(
      `Could not save cloud data: ${error.message}. Check that database migrations 001–010 are installed.`,
    );
}
async function imageData(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      "A cloud photo could not be downloaded for backup. Please retry.",
    );
  return blobToDataUrl(await response.blob());
}
function validGradePreferences(value: unknown): Record<string, string> {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, value]) =>
          key.startsWith("bouldero-grade:") &&
          ["V", "Font", "Custom"].includes(String(value)),
      )
      .map(([key, value]) => [key, String(value)]),
  );
}
export async function loadCloudPreferences() {
  if (!supabase) return {};
  const id = await owner();
  const { data, error } = await supabase
    .from("users")
    .select("gym_grade_systems")
    .eq("id", id)
    .single();
  if (error) throw error;
  const preferences = validGradePreferences(data.gym_grade_systems);
  Object.keys(localStorage)
    .filter((key) => key.startsWith("bouldero-grade:"))
    .forEach((key) => localStorage.removeItem(key));
  Object.entries(preferences).forEach(([key, value]) =>
    localStorage.setItem(key, value),
  );
  return preferences;
}
export async function persistGymGradeSystem(gym: string, value: string) {
  const key = `bouldero-grade:${gym.trim().toLowerCase()}`;
  if (supabase) await commitWorkspace({ grades: { [key]: value } });
  localStorage.setItem(key, value);
}
