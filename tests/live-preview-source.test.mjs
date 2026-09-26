import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the real derived expression. In particular, a persisted result must
// not cause an early return before Svelte can track the current preview frame.
const source = readFileSync(new URL('../src/lib/components/progress/PreviewImage.svelte', import.meta.url), 'utf8');
const body = source.match(/const previewSrc = \$derived\.by\(\(\) => \{([\s\S]*?)\n  \}\);/)[1];
const select = new Function('progress', 'getSavedImageForUrl', 'getActiveSavedImage', body);

test('live frames replace a persisted output before and after tab remount', () => {
  const saved = { url: 'blob:previous', fullImageUrl: 'gallery://previous.png', gallery_filename: 'previous.png' };
  let frame = null;
  let reads = 0;
  const progress = { get displayImage() { reads++; return frame ?? saved.url; } };
  const render = () => select(progress, url => url === saved.url ? saved : null, () => saved);
  assert.equal(render(), saved.fullImageUrl);
  assert.equal(reads, 1, 'even the saved-image render must subscribe to the live source');
  for (const url of ['blob:first-frame', 'blob:second-frame', 'blob:after-tab-remount']) {
    frame = url;
    assert.equal(render(), url);
  }
  frame = null;
  assert.equal(render(), saved.fullImageUrl);
});

test('JXL output uses its decoded URL, and an empty mode stays empty', () => {
  const saved = { url: 'blob:decoded', fullImageUrl: 'gallery://result.jxl', gallery_filename: 'result.jxl' };
  assert.equal(select({ displayImage: saved.url }, () => saved, () => saved), saved.url);
  assert.equal(select({ displayImage: null }, () => null, () => saved), null);
});
