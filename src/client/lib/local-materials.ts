export interface LocalMaterial {
  id: string;
  moduleCode: string;
  folder: string;
  name: string;
  path: string;
  blob: Blob;
  addedAt: string;
  lastOpenedAt?: string;
  secondsViewed: number;
}

const DB = "semester-os-local-materials";
const VERSION = 1;
const STORE = "materials";
const STUDY_STORE = "study";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STUDY_STORE)) db.createObjectStore(STUDY_STORE, { keyPath: "moduleCode" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listMaterials(moduleCode?: string): Promise<LocalMaterial[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as LocalMaterial[]).filter((m) => !moduleCode || m.moduleCode === moduleCode));
    request.onerror = () => reject(request.error);
  });
}

export async function saveMaterials(items: LocalMaterial[]): Promise<void> {
  if (!items.length) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    items.forEach((item) => tx.objectStore(STORE).put(item));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

export async function updateMaterial(item: LocalMaterial): Promise<void> {
  const db = await open();
  db.transaction(STORE, "readwrite").objectStore(STORE).put(item);
}

export async function addStudyTime(moduleCode: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const db = await open();
  const store = db.transaction(STUDY_STORE, "readwrite").objectStore(STUDY_STORE);
  const current = await new Promise<{ moduleCode: string; seconds: number } | undefined>((resolve) => {
    const request = store.get(moduleCode); request.onsuccess = () => resolve(request.result);
  });
  store.put({ moduleCode, seconds: (current?.seconds ?? 0) + seconds });
}

export async function studySeconds(moduleCode: string): Promise<number> {
  const db = await open();
  return new Promise((resolve) => { const request = db.transaction(STUDY_STORE).objectStore(STUDY_STORE).get(moduleCode); request.onsuccess = () => resolve(request.result?.seconds ?? 0); request.onerror = () => resolve(0); });
}
