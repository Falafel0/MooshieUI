export interface TelegramPromptRecipe {
  id: string;
  chat: string;
  date: string;
  positive: string;
  negative: string;
  sourceText: string;
}

function flattenTelegramText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}

const POSITIVE_LABEL = /^(?:positive(?:\s+prompt)?|prompt|промпт|позитивный(?:\s+промпт)?|положительный(?:\s+промпт)?)\s*[:：-]\s*/i;
const NEGATIVE_LABEL = /^(?:negative(?:\s+prompt)?|neg(?:ative)?|негативный(?:\s+промпт)?|отрицательный(?:\s+промпт)?)\s*[:：-]\s*/i;
const SETTINGS_LABEL = /^(?:steps?|sampler|scheduler|cfg(?:\s*scale)?|seed|model|checkpoint|clip\s*skip|size|width|height|denoise|шаги|сэмплер|модель|сид)\s*[:：-]/i;

function cleanPrompt(value: string): string {
  return value
    .replace(/```(?:\w+)?/g, "")
    .replace(/\s*\n\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/^\s*,|,\s*$/g, "")
    .trim();
}

export function extractPromptPair(text: string): { positive: string; negative: string } | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const positive: string[] = [];
  const negative: string[] = [];
  let target: "positive" | "negative" | null = null;
  let sawLabel = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (POSITIVE_LABEL.test(line)) {
      sawLabel = true;
      target = "positive";
      const rest = line.replace(POSITIVE_LABEL, "").trim();
      if (rest) positive.push(rest);
      continue;
    }
    if (NEGATIVE_LABEL.test(line)) {
      sawLabel = true;
      target = "negative";
      const rest = line.replace(NEGATIVE_LABEL, "").trim();
      if (rest) negative.push(rest);
      continue;
    }
    if (SETTINGS_LABEL.test(line)) {
      target = null;
      continue;
    }
    if (target === "positive") positive.push(line);
    if (target === "negative") negative.push(line);
  }

  if (!sawLabel) {
    const candidate = cleanPrompt(text);
    const tagLike = (candidate.match(/,/g)?.length ?? 0) >= 3;
    if (!tagLike || candidate.length < 24 || candidate.length > 12_000) return null;
    return { positive: candidate, negative: "" };
  }

  const pair = { positive: cleanPrompt(positive.join("\n")), negative: cleanPrompt(negative.join("\n")) };
  return pair.positive ? pair : null;
}

function collectJsonMessages(root: unknown): Array<{ chat: string; message: any }> {
  if (!root || typeof root !== "object") return [];
  const data = root as any;
  const chats = Array.isArray(data?.chats?.list)
    ? data.chats.list
    : Array.isArray(data?.messages)
      ? [{ name: data.name ?? data.title ?? "Telegram", messages: data.messages }]
      : [];
  const output: Array<{ chat: string; message: any }> = [];
  for (const chat of chats) {
    if (!Array.isArray(chat?.messages)) continue;
    const chatName = String(chat.name ?? chat.title ?? "Telegram");
    for (const message of chat.messages) output.push({ chat: chatName, message });
  }
  return output;
}

export function parseTelegramJson(text: string): TelegramPromptRecipe[] {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  const recipes: TelegramPromptRecipe[] = [];
  for (const { chat, message } of collectJsonMessages(parsed)) {
    if (!message || message.type === "service") continue;
    const sourceText = flattenTelegramText(message.text ?? message.text_entities);
    const pair = extractPromptPair(sourceText);
    if (!pair) continue;
    recipes.push({
      id: `${chat}:${message.id ?? recipes.length}`,
      chat,
      date: String(message.date ?? message.date_unixtime ?? ""),
      positive: pair.positive,
      negative: pair.negative,
      sourceText,
    });
  }
  return recipes;
}

export function parseTelegramHtml(text: string): TelegramPromptRecipe[] {
  const doc = new DOMParser().parseFromString(text, "text/html");
  // textContent omits the line breaks represented by Telegram's <br> tags.
  // Preserve them before recognizing positive/negative/settings headings.
  for (const br of doc.querySelectorAll("br")) br.replaceWith("\n");
  const recipes: TelegramPromptRecipe[] = [];
  for (const [index, message] of [...doc.querySelectorAll(".message")].entries()) {
    if (message.classList.contains("service")) continue;
    const sourceText = message.querySelector(".text")?.textContent?.trim() ?? "";
    const pair = extractPromptPair(sourceText);
    if (!pair) continue;
    const chat = message.querySelector(".from_name")?.textContent?.trim() || doc.title || "Telegram";
    const dateNode = message.querySelector(".date");
    recipes.push({
      id: message.id || `telegram-html:${index}`,
      chat,
      date: dateNode?.getAttribute("title") || dateNode?.textContent?.trim() || "",
      positive: pair.positive,
      negative: pair.negative,
      sourceText,
    });
  }
  return recipes;
}

export function parseTelegramExport(fileName: string, text: string): TelegramPromptRecipe[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json") || text.trimStart().startsWith("{")) return parseTelegramJson(text);
  return parseTelegramHtml(text);
}
