import type { UiCommand } from "../utils/commands.js";
import { untrack } from "svelte";

class CommandsStore {
  private groups = $state<Record<string, UiCommand[]>>({});
  isOpen = $state(false);
  scope = $state<string | null>(null);

  get entries(): UiCommand[] {
    return Object.values(this.groups).flat();
  }

  get availableEntries(): UiCommand[] {
    return this.scope ? (this.groups[this.scope] ?? []) : this.entries;
  }

  register(entries: UiCommand[], scope = "global") {
    this.groups = untrack(() => ({ ...this.groups, [scope]: [...entries] }));
  }

  unregister(scope: string) {
    this.groups = untrack(() => Object.fromEntries(Object.entries(this.groups).filter(([key]) => key !== scope)));
  }

  show(scope: string | null = null) { this.scope = scope; this.isOpen = true; }
  close() { this.isOpen = false; }
}

export const commands = new CommandsStore();
