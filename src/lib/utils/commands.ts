export interface UiCommand {
  id: string;
  labelKey: string;
  keywords?: string;
  run: () => void;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export function filterCommands(commands: UiCommand[], query: string, translate: (key: string) => string): UiCommand[] {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return commands.filter((command) => {
    const text = normalize(`${translate(command.labelKey)} ${command.keywords ?? ""}`);
    return terms.every((term) => text.includes(term));
  });
}
