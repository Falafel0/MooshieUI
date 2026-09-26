// Contract: the unsaved-changes guard has to be reachable from every surface
// that can throw a document away.
//
// A project can be opened from the canvas bar and from the settings section, and
// both go through `projects.requestGuarded`. While the dialog was mounted inside
// the canvas bar only, opening a project from settings with unsaved changes left
// the request unanswered -- the button simply did nothing. The dialog therefore
// lives at app level, exactly once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the guard dialog is mounted once, at app level', () => {
    const app = read('../src/App.svelte');
    assert.ok(app.includes('import ProjectGuardDialog from "./lib/components/projects/ProjectGuardDialog.svelte"'), 'App must import the guard dialog');
    assert.ok(app.includes('<ProjectGuardDialog />'), 'App must render the guard dialog');

    const bar = read('../src/lib/components/canvas/ProjectBar.svelte');
    assert.ok(!bar.includes('projects.guard.open'), 'the canvas bar must not mount its own copy');
    assert.ok(!bar.includes('answerGuard'), 'the canvas bar must not answer the guard itself');

    const dialog = read('../src/lib/components/projects/ProjectGuardDialog.svelte');
    assert.ok(dialog.includes('projects.guard.open'), 'the dialog renders on the guard state');
    assert.ok(dialog.includes('answerGuard("save")') && dialog.includes('answerGuard("discard")') && dialog.includes('answerGuard("cancel")'), 'all three answers must be offered');
});
