import type { WorkspacePage } from "../utils/workspaces.js";

class WorkspaceStore {
  current = $state<WorkspacePage>("generate");
  settingsSection = $state<string | null>(null);

  open(page: WorkspacePage) {
    this.current = page;
  }

  openSettings(section: string) {
    this.settingsSection = section;
    this.open("settings");
  }
}

export const workspace = new WorkspaceStore();
