import type { UiCommand } from "../utils/commands.js";

class CommandsStore {
  entries = $state<UiCommand[]>([]);
  isOpen = $state(false);

  register(entries: UiCommand[]) {
    this.entries = [...entries];
  }

  show() { this.isOpen = true; }
  close() { this.isOpen = false; }
}

export const commands = new CommandsStore();
