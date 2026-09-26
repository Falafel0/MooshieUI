/**
 * Projects, as documents: one workspace, opened, saved and closed by name.
 *
 * The store owns the lifecycle and nothing else — the canvas store knows how to
 * turn itself into a document and back, the backend knows how to keep one, and
 * this is what joins them: which project is open, whether it has unsaved
 * changes, and the guard that stands between a careless click and a lost
 * picture.
 *
 * "Dirty" is decided by comparing signatures, never by a flag a caller sets:
 * the document's shape (with the canvas store's picture revision standing in
 * for its pixels) and the settings that travel with it. A signature pair is
 * taken whenever a document is saved, opened or created, and re-checked on a
 * timer, which is what the dot in the project bar shows.
 */
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  type ProjectRecord,
} from "../utils/api.js";
import {
  documentSignature,
  isProjectDocument,
  settingsSignature,
  type ProjectDocument,
} from "../utils/projectDocument.js";
import { projectIdFromName } from "../utils/projectId.js";
import type { UserPrefsData } from "../utils/serverPrefs.js";
import { canvas } from "./canvas.svelte.js";
import { gallery } from "./gallery.svelte.js";
import { locale } from "./locale.svelte.js";
import { prefsSync } from "./prefsSync.svelte.js";

/** How often unsaved changes are re-checked while a workspace is on screen. */
const DIRTY_POLL_MS = 3000;

export interface ProjectGuardState {
  open: boolean;
  /** What the guard is protecting: the action waiting behind it. The store
   * never reads what it returns, so an action is free to report its own
   * outcome (a save answering whether it worked, for instance). */
  action: (() => void | Promise<unknown>) | null;
}

class ProjectsStore {
  /** The open project, or null while the workspace is untitled. */
  currentId = $state<string | null>(null);
  currentName = $state("");
  /** True while the open document differs from what was last saved or opened. */
  dirty = $state(false);
  saving = $state(false);
  loading = $state(false);
  lastError = $state("");
  projects = $state<ProjectRecord[]>([]);
  /** The unsaved-changes guard, driven by whichever surface asked for it. */
  guard = $state<ProjectGuardState>({ open: false, action: null });
  /** The project row whose action is running, if any. */
  busyId = $state<string | null>(null);

  private savedDocument = "none";
  private savedSettings = "none";
  private poll: ReturnType<typeof setInterval> | null = null;

  /** What the bar calls the open document. */
  get displayName(): string {
    return this.currentName.trim() || locale.t("projects.untitled");
  }

  /** Start watching for unsaved changes; the workspace calls this on mount. */
  watch() {
    if (this.poll !== null) return;
    this.poll = setInterval(() => this.refreshDirty(), DIRTY_POLL_MS);
  }

  /** Stop watching; the workspace calls this when it goes away. */
  unwatch() {
    if (this.poll === null) return;
    clearInterval(this.poll);
    this.poll = null;
  }

  /** Re-check whether the open document still matches what was saved. */
  refreshDirty() {
    if (this.saving || this.loading) return;
    this.dirty =
      documentSignature(canvas.documentShape(), canvas.paintRevision) !== this.savedDocument ||
      settingsSignature(prefsSync.collectAll()) !== this.savedSettings;
  }

  /** Take the current state as "what the stored project holds". */
  private markSaved() {
    this.savedDocument = documentSignature(canvas.documentShape(), canvas.paintRevision);
    this.savedSettings = settingsSignature(prefsSync.collectAll());
    this.dirty = false;
  }

  /**
   * Run an action that may throw the open document away — closing it, opening
   * another, creating a new one — asking about unsaved changes first when there
   * are any. Without unsaved changes the action runs at once.
   */
  requestGuarded(action: () => void | Promise<unknown>) {
    this.refreshDirty();
    if (!this.dirty) {
      void action();
      return;
    }
    this.guard = { open: true, action };
  }

  /**
   * Run a project action with its row marked busy.
   *
   * The mark belongs to whoever runs the action, not to the click: an open can
   * wait behind the unsaved-changes guard, and a flag cleared at the call site
   * would let a second project be opened while the first is still loading. A
   * cancelled guard never runs the action, so nothing is ever left marked.
   */
  async runBusy(id: string, action: () => void | Promise<unknown>): Promise<void> {
    this.busyId = id;
    try {
      await action();
    } finally {
      this.busyId = null;
    }
  }

  /** Answer the guard: save first, drop the changes, or cancel the action. */
  async answerGuard(answer: "save" | "discard" | "cancel") {
    const action = this.guard.action;
    this.guard = { open: false, action: null };
    if (answer === "cancel") return;
    if (answer === "save") {
      const saved = await this.save();
      if (!saved) return;
    }
    if (action) await action();
  }

  async refreshList() {
    this.loading = true;
    this.lastError = "";
    try {
      this.projects = await listProjects();
    } catch (error) {
      this.lastError = describe(error);
    } finally {
      this.loading = false;
    }
  }

  /** Save the open document. An untitled document needs a name first. */
  async save(): Promise<boolean> {
    if (!this.currentId) {
      this.lastError = locale.t("projects.save_needs_name");
      return false;
    }
    return this.writeProject(this.currentId, this.currentName);
  }

  /** Save the open document under a name, creating or updating that project. */
  async saveAs(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) {
      this.lastError = locale.t("projects.name_required");
      return false;
    }
    const existing = this.projects.find(
      (project) => project.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    return this.writeProject(existing?.id ?? projectIdFromName(trimmed), trimmed);
  }

  private async writeProject(id: string, name: string): Promise<boolean> {
    this.saving = true;
    this.lastError = "";
    try {
      const document_ = await canvas.captureDocument();
      // A document that cannot be opened again is not a save: refuse it here,
      // with the reason, instead of writing a project that loses pixels.
      if (!isProjectDocument(document_)) {
        this.lastError = locale.t("projects.capture_failed");
        return false;
      }
      const stored = await saveProject({
        id,
        name,
        description: "",
        createdAt: "",
        updatedAt: "",
        thumbnail: null,
        // The backend keeps `data` opaque on purpose, so the payload is typed
        // as what it is: this build's own document plus the settings that
        // belong to it.
        data: { document: document_, generation: prefsSync.collectAll() } as unknown as UserPrefsData,
      });
      this.currentId = stored.id;
      this.currentName = stored.name;
      this.markSaved();
      gallery.showToast(locale.t("projects.saved", { name: stored.name }), "success");
      await this.refreshList();
      return true;
    } catch (error) {
      this.lastError = describe(error);
      gallery.showToast(locale.t("projects.save_failed", { message: describe(error) }), "error");
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** Start a new, empty document; it stays unsaved until it is saved by name. */
  async create(name: string, width: number, height: number, background: string): Promise<boolean> {
    try {
      canvas.newDocument(width, height, background);
      this.currentId = null;
      this.currentName = name.trim();
      this.markSaved();
      // A brand-new document has never been stored: it counts as unsaved.
      this.dirty = true;
      gallery.showToast(locale.t("projects.created", { name: this.displayName }), "success");
      return true;
    } catch (error) {
      this.lastError = describe(error);
      return false;
    }
  }

  /** Open a stored project, replacing the workspace. */
  async open(id: string): Promise<boolean> {
    this.loading = true;
    this.lastError = "";
    try {
      const stored = await loadProject(id);
      const data = stored.data as
        | { document?: unknown; generation?: unknown }
        | null
        | undefined;
      const document_ = data && typeof data === "object" ? data.document : undefined;
      if (document_ !== undefined && !isProjectDocument(document_)) {
        this.lastError = locale.t("projects.invalid_document");
        return false;
      }
      if (isProjectDocument(document_)) {
        canvas.loadDocument(document_);
        const generation = (data as { generation?: unknown } | undefined)?.generation;
        if (generation && typeof generation === "object") {
          await prefsSync.applyAll(generation as UserPrefsData);
        }
      } else {
        // A project saved before projects held a canvas: its settings still
        // load, and the canvas is honestly empty rather than half-restored.
        await prefsSync.applyAll(stored.data);
        gallery.showToast(locale.t("projects.legacy_project"), "success");
      }
      this.currentId = stored.id;
      this.currentName = stored.name;
      this.markSaved();
      gallery.showToast(locale.t("projects.loaded", { name: stored.name }), "success");
      return true;
    } catch (error) {
      this.lastError = describe(error);
      gallery.showToast(locale.t("projects.load_failed", { message: describe(error) }), "error");
      return false;
    } finally {
      this.loading = false;
    }
  }

  /** Close the open document: the workspace goes back to being untitled. */
  async close() {
    canvas.newDocument(canvas.canvasWidth, canvas.canvasHeight, canvas.backgroundColor);
    this.currentId = null;
    this.currentName = "";
    this.markSaved();
  }

  async rename(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) {
      this.lastError = locale.t("projects.name_required");
      return false;
    }
    const project = this.projects.find((candidate) => candidate.id === id);
    if (!project) return false;
    try {
      const stored = await saveProject({ ...project, name: trimmed, updatedAt: "" });
      if (this.currentId === stored.id) this.currentName = stored.name;
      await this.refreshList();
      return true;
    } catch (error) {
      this.lastError = describe(error);
      return false;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await deleteProject(id);
      if (this.currentId === id) {
        this.currentId = null;
        this.currentName = "";
      }
      await this.refreshList();
      return true;
    } catch (error) {
      gallery.showToast(locale.t("projects.delete_failed", { message: describe(error) }), "error");
      return false;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const projects = new ProjectsStore();
