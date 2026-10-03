import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const utilityUrls = new Map();
async function utilityUrl(name) {
  if (utilityUrls.has(name)) return utilityUrls.get(name);
  const source = await readFile(new URL(`../src/lib/utils/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  let linked = outputText;
  for (const match of outputText.matchAll(/from\s+["']\.\/([^"']+)\.js["']/g)) {
    linked = linked.replace(match[0], `from ${JSON.stringify(await utilityUrl(match[1]))}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`;
  utilityUrls.set(name, url);
  return url;
}
async function loadUtility(name) {
  return import(await utilityUrl(name));
}

const { parseTelegramJson, extractPromptPair } = await loadUtility("telegramPromptImport");
const { updateTagList } = await loadUtility("animaIntegration");
assert.equal(updateTagList("red hair, blue eyes", "red hair"), "blue eyes, red hair");
assert.equal(updateTagList("red hair, blue eyes", "red hair", true), "blue eyes");
assert.deepEqual(extractPromptPair("Prompt: flower, watercolor\nNegative prompt: blurry\nSteps: 20"), {
  positive: "flower, watercolor", negative: "blurry",
});
assert.equal(extractPromptPair("Welcome to the channel!"), null);
const exported = { chats: { list: [{ name: "Prompts", messages: [
  { id: 1, type: "message", text: ["Промпт: ", { type: "bold", text: "цветок, акварель" }, "\nНегативный промпт: шум"] },
  { id: 2, type: "service", text: "Prompt: ignore" },
] }] } };
const recipes = parseTelegramJson("\uFEFF" + JSON.stringify(exported));
assert.equal(recipes.length, 1);
assert.equal(recipes[0].positive, "цветок, акварель");
assert.equal(recipes[0].negative, "шум");
assert.equal(recipes[0].chat, "Prompts");
assert.throws(() => parseTelegramJson("not JSON"));
console.log("Telegram export and tag-group regression checks passed.");
