// Contract: a thumbnail may only be cached while the URL identifies the exact
// bytes it was made from. The gallery asks with `?v=<modified>-<size>`, so the
// two handlers that serve thumbnails must not answer `no-cache`, and the URL
// must keep its version query -- dropping either half re-decodes every JXL the
// grid scrolls past.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the gallery asks for a thumbnail with a version in the URL', () => {
    const gallery = read('../src/lib/stores/gallery.svelte.ts');
    assert.ok(
        gallery.includes('thumbnailUrl: `${thumb}${thumb.includes("?") ? "&" : "?"}v=${version}`'),
        'the thumbnail URL must carry the version query',
    );
    assert.match(gallery, /const version = .*modified_ms.*size_bytes/s);
});

test('both thumbnail handlers allow a cached answer', () => {
    const tauri = read('../src-tauri/src/lib.rs');
    const web = read('../src-tauri/src/webserver.rs');
    // The Tauri custom-protocol handler: the webp thumbnail response, not the
    // mp4 range responses that legitimately stay uncached.
    const at = tauri.indexOf('commands::api::generate_thumbnail');
    const tauriThumb = tauri.slice(at, at + 1200);
    assert.match(tauriThumb, /Cache-Control", "max-age=\d+"/);
    assert.doesNotMatch(tauriThumb, /no-cache/);
    const webThumb = web.slice(web.indexOf('fn thumbnail_handler'), web.indexOf('fn gallery_image_handler'));
    assert.match(webThumb, /"cache-control", "max-age=\d+"/);
    assert.doesNotMatch(webThumb, /no-cache/);
});
