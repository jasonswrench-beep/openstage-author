// Tests for the media libraries, with canned answers that follow each service's documentation. They are not
// real replies: a key is needed to get one, and the author uses their own.
import { emptyAi } from "./aiservices.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ccFromUrl, clock, creditFor, freesoundLicence, nameFor, PAGE_SIZE, parseSettings, pickVideoFile, searchStock, searchUrl, serializeSettings, sourcesFor,
  LINK_SOURCES, SOURCES, trackDownload, type Get, type MediaKind, type Provider,
} from "./stock.ts";

const pixabay = JSON.stringify({
  total: 500, totalHits: 60,
  hits: [{ id: 195893, pageURL: "https://pixabay.com/photos/blossom-195893/", tags: "blossom, bloom, flower", previewURL: "https://cdn.pixabay.com/p.jpg", webformatURL: "https://pixabay.com/get/w.jpg", largeImageURL: "https://pixabay.com/get/l.jpg", imageWidth: 4000, imageHeight: 3000, user: "Josch13", user_id: 1664300 }],
});
const unsplash = JSON.stringify({
  total: 133, total_pages: 12,
  results: [{ id: "eOLpJytrbsQ", width: 5245, height: 3497, alt_description: "a white flower in the rain", description: null,
    urls: { small: "https://images.unsplash.com/s.jpg", regular: "https://images.unsplash.com/r.jpg", full: "https://images.unsplash.com/f.jpg" },
    links: { html: "https://unsplash.com/photos/eOLpJytrbsQ", download_location: "https://api.unsplash.com/photos/eOLpJytrbsQ/download?ixid=x" },
    user: { name: "Jane Doe", links: { html: "https://unsplash.com/@jane" } } }],
});
const pexelsPhotos = JSON.stringify({
  page: 1, per_page: 24, total_results: 8000, next_page: "https://api.pexels.com/v1/search/?page=2&per_page=24&query=flower",
  photos: [{ id: 736230, width: 4000, height: 6000, url: "https://www.pexels.com/photo/pink-flower-736230/", photographer: "Jane Doe", photographer_url: "https://www.pexels.com/@jane", alt: "Pink petals close up",
    src: { original: "https://images.pexels.com/photos/736230/o.jpeg", large2x: "https://images.pexels.com/photos/736230/l2.jpeg", large: "https://images.pexels.com/photos/736230/l.jpeg", medium: "https://images.pexels.com/photos/736230/m.jpeg", small: "https://images.pexels.com/photos/736230/s.jpeg" } }],
});
const pexelsVideos = JSON.stringify({
  page: 1, per_page: 24, total_results: 40, next_page: "",
  videos: [
    { id: 855564, width: 3840, height: 2160, url: "https://www.pexels.com/video/waves-on-a-beach-855564/", image: "https://images.pexels.com/videos/855564/p.jpeg", duration: 15, user: { name: "Sam Lee", url: "https://www.pexels.com/@sam" },
      video_files: [
        { id: 1, quality: "uhd", file_type: "video/mp4", width: 3840, height: 2160, link: "https://videos.pexels.com/video-files/855564/uhd.mp4" },
        { id: 2, quality: "hd", file_type: "video/mp4", width: 1280, height: 720, link: "https://videos.pexels.com/video-files/855564/hd.mp4" },
        { id: 3, quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "https://videos.pexels.com/video-files/855564/sd.mp4" },
        { id: 4, quality: "hls", file_type: "application/x-mpegURL", width: 0, height: 0, link: "https://videos.pexels.com/video-files/855564/a.m3u8" },
      ] },
    { id: 2, width: 100, height: 100, url: "https://www.pexels.com/video/x-2/", image: "", duration: 3, user: { name: "N", url: "" }, video_files: [{ id: 9, quality: "hls", file_type: "application/x-mpegURL", width: 0, height: 0, link: "https://x/a.m3u8" }] },
  ],
});
const freesound = JSON.stringify({
  count: 77, next: "https://freesound.org/apiv2/search/?page=2", previous: null,
  results: [
    { id: 401275, name: "Rain, Moderate, C.wav", username: "InspectorJ", license: "https://creativecommons.org/licenses/by/4.0/", url: "https://freesound.org/people/InspectorJ/sounds/401275/", duration: 60.1,
      previews: { "preview-hq-mp3": "https://cdn.freesound.org/previews/401/401275_5121236-hq.mp3", "preview-lq-mp3": "https://cdn.freesound.org/previews/401/401275_5121236-lq.mp3" } },
    { id: 2, name: "Zero", username: "Someone", license: "http://creativecommons.org/publicdomain/zero/1.0/", url: "https://freesound.org/people/Someone/sounds/2/", duration: 3, previews: { "preview-lq-mp3": "https://cdn.freesound.org/previews/2/2-lq.mp3" } },
    { id: 3, name: "Not for a course", username: "Other", license: "https://creativecommons.org/licenses/by-nc/4.0/", url: "https://freesound.org/people/Other/sounds/3/", duration: 3, previews: { "preview-hq-mp3": "https://cdn.freesound.org/previews/3/3-hq.mp3" } },
    { id: 4, name: "No preview", username: "Other", license: "https://creativecommons.org/licenses/by/4.0/", url: "https://freesound.org/people/Other/sounds/4/", duration: 3, previews: {} },
  ],
});
function recorder(body: string) {
  const calls: { url: string; headers: [string, string][] }[] = [];
  const get: Get = async (url, headers) => { calls.push({ url, headers }); return body; };
  return { get, calls };
}
const run = (provider: Provider, kind: MediaKind, body: string, key = "KEY", page = 1) => searchStock(provider, kind, "flower", page, key, recorder(body).get);

test("every source says which kinds it has, and whether it needs a key", () => {
  assert.deepEqual(sourcesFor("video").map((s) => s.id).sort(), ["pexels"]);
  assert.deepEqual(sourcesFor("audio").map((s) => s.id).sort(), ["freesound"]);
  assert.deepEqual(sourcesFor("image").map((s) => s.id).sort(), ["pexels", "pixabay", "unsplash"]);
  assert.ok(SOURCES.every((s) => s.keyName !== "" && s.keyUrl.startsWith("https://")), "every source says what key it needs and where to get one");
});

test("every site can be opened in a browser with no key, and those that can be searched here say so", () => {
  for (const s of SOURCES) {
    const link = LINK_SOURCES.find((l) => l.searchId === s.id);
    assert.ok(link, `${s.name} has a link for people with no key`);
    assert.deepEqual(link!.kinds.sort(), [...s.kinds].sort(), `${s.name}'s link covers what it can search`);
  }
  assert.ok(LINK_SOURCES.every((l) => l.url.startsWith("https://") && l.note.length > 0));
  assert.ok(LINK_SOURCES.some((l) => l.searchId === undefined), "some sites can only be opened");
});

test("a Pixabay search puts the key and the encoded words in the address and keeps credit details", async () => {
  const { get, calls } = recorder(pixabay);
  const page = await searchStock("pixabay", "image", "red & blue flowers", 1, "KEY123", get);
  assert.match(calls[0]!.url, /^https:\/\/pixabay\.com\/api\/\?key=KEY123&q=red%20%26%20blue%20flowers&/);
  assert.match(calls[0]!.url, /safesearch=true/);
  const h = page.hits[0]!;
  assert.equal(h.downloadUrl, "https://pixabay.com/get/l.jpg");
  assert.equal(h.creatorUrl, "https://pixabay.com/users/Josch13-1664300/");
  assert.equal(h.requiresCredit, false);
  assert.equal(h.suggestedAlt, "", "Pixabay's tags are not a description");
  assert.equal(page.hasMore, true);
});

test("an Unsplash search sends the key in a header, asks for safe results, and requires credit", async () => {
  const { get, calls } = recorder(unsplash);
  const page = await searchStock("unsplash", "image", "flower", 2, "ACCESS", get);
  assert.match(calls[0]!.url, /^https:\/\/api\.unsplash\.com\/search\/photos\?query=flower&per_page=24&page=2&content_filter=high$/);
  assert.deepEqual(calls[0]!.headers, [["Authorization", "Client-ID ACCESS"], ["Accept-Version", "v1"]]);
  assert.ok(!calls[0]!.url.includes("ACCESS"));
  const h = page.hits[0]!;
  assert.equal(h.requiresCredit, true);
  assert.equal(h.creatorUrl, "https://unsplash.com/@jane?utm_source=OpenStage&utm_medium=referral");
  assert.equal(h.suggestedAlt, "a white flower in the rain");
});

test("Pexels pictures use the key as the whole Authorization header, and keep the photographer's details", async () => {
  const { get, calls } = recorder(pexelsPhotos);
  const page = await searchStock("pexels", "image", "pink flower", 1, "PEXKEY", get);
  assert.equal(calls[0]!.url, "https://api.pexels.com/v1/search?query=pink%20flower&per_page=24&page=1");
  assert.deepEqual(calls[0]!.headers, [["Authorization", "PEXKEY"]]);
  const h = page.hits[0]!;
  assert.equal(h.kind, "image");
  assert.equal(h.downloadUrl, "https://images.pexels.com/photos/736230/l2.jpeg");
  assert.equal(h.preview, "https://images.pexels.com/photos/736230/m.jpeg");
  assert.equal(h.creator, "Jane Doe");
  assert.equal(h.licence, "Pexels Licence");
  assert.equal(h.requiresCredit, false);
  assert.equal(h.suggestedAlt, "Pink petals close up");
  assert.equal(page.hasMore, true);
});

test("Pexels video picks an mp4 near 1280 wide, skips ones with no usable file, and gives the length", async () => {
  const { get, calls } = recorder(pexelsVideos);
  const page = await searchStock("pexels", "video", "waves", 1, "K", get);
  assert.match(calls[0]!.url, /^https:\/\/api\.pexels\.com\/v1\/videos\/search\?query=waves/);
  assert.equal(page.hits.length, 1, "the one with only a streaming file is left out");
  const h = page.hits[0]!;
  assert.equal(h.downloadUrl, "https://videos.pexels.com/video-files/855564/hd.mp4");
  assert.equal(h.duration, 15);
  assert.equal(h.preview, "https://images.pexels.com/videos/855564/p.jpeg");
  assert.equal(h.creator, "Sam Lee");
  assert.equal(h.title, "waves on a beach");
  assert.equal(page.hasMore, false);
  assert.equal(pickVideoFile([]), null);
  assert.equal(pickVideoFile([{ file_type: "video/mp4", width: 640, link: "a" }, { file_type: "video/mp4", width: 3840, link: "b" }])!["link"], "a", "never above Full HD when there is a smaller one");
  assert.equal(pickVideoFile([{ file_type: "video/mp4", width: 3840, link: "b" }, { file_type: "video/mp4", width: 2560, link: "c" }])!["link"], "c", "if all are large, the smallest");
  assert.equal(pickVideoFile([{ file_type: "video/mp4", width: 1920, link: "f" }, { file_type: "video/mp4", width: 1280, link: "h" }])!["link"], "h");
});

test("Freesound sends its key as a Token, keeps only licences a course can use, and needs a preview to offer", async () => {
  const { get, calls } = recorder(freesound);
  const page = await searchStock("freesound", "audio", "rain", 1, "FSKEY", get);
  assert.deepEqual(calls[0]!.headers, [["Authorization", "Token FSKEY"]]);
  assert.ok(!calls[0]!.url.includes("FSKEY"));
  assert.match(decodeURIComponent(calls[0]!.url), /filter=license:\("Creative Commons 0" OR "Attribution"\)/);
  assert.ok(calls[0]!.url.startsWith("https://freesound.org/apiv2/search/?"), "the current search address, not the one Freesound retired");
  assert.ok(!calls[0]!.url.includes("/search/text/"));
  assert.deepEqual(page.hits.map((h) => h.id), ["401275", "2"], "the non-commercial one and the one with no preview are left out");
  assert.equal(page.hits[0]!.licence, "CC BY 4.0");
  assert.equal(page.hits[0]!.requiresCredit, true);
  assert.equal(page.hits[0]!.creatorUrl, "https://freesound.org/people/InspectorJ/");
  assert.equal(page.hits[0]!.downloadUrl, "https://cdn.freesound.org/previews/401/401275_5121236-hq.mp3");
  assert.equal(page.hits[1]!.licence, "CC0 1.0");
  assert.equal(page.hits[1]!.requiresCredit, false);
  assert.equal(page.hits[1]!.downloadUrl, "https://cdn.freesound.org/previews/2/2-lq.mp3", "falls back to the smaller preview");
  assert.equal(page.hasMore, true);
});

test("Freesound's licence is understood as a name too, which is how its documentation lists it", async () => {
  const sound = (id: number, license: string) => ({ id, name: `Sound ${id}`, username: "Someone", license, url: `https://freesound.org/people/Someone/sounds/${id}/`, duration: 4, previews: { "preview-hq-mp3": `https://cdn.freesound.org/previews/${id}.mp3` } });
  const named = JSON.stringify({ count: 5, next: null, previous: null, results: [
    sound(1, "Attribution"), sound(2, "Creative Commons 0"), sound(3, "Attribution NonCommercial"), sound(4, "Sampling+"), sound(5, "") ] });
  const page = await searchStock("freesound", "audio", "rain", 1, "FSKEY", recorder(named).get);
  assert.deepEqual(page.hits.map((h) => h.id), ["1", "2"], "only CC0 and plain Attribution; a licence that cannot be read is not assumed to be fine");
  assert.deepEqual(page.hits.map((h) => [h.licence, h.requiresCredit]), [["CC BY", true], ["CC0 1.0", false]]);
  assert.equal(freesoundLicence("https://creativecommons.org/licenses/by-nc/4.0/"), null);
  assert.equal(freesoundLicence("https://creativecommons.org/licenses/by-sa/4.0/"), null);
  assert.equal(freesoundLicence("http://creativecommons.org/licenses/by/3.0/")!.label, "CC BY 3.0");
  assert.equal(freesoundLicence("  attribution ")!.cc0, false);
});

test("paging stops when there is no more", async () => {
  assert.equal((await run("pixabay", "image", pixabay, "k", 3)).hasMore, false);
  assert.equal((await run("unsplash", "image", unsplash, "k", 12)).hasMore, false);
  assert.equal((await run("pexels", "video", pexelsVideos, "k")).hasMore, false);
  assert.equal(PAGE_SIZE, 24);
});

test("a missing key, an empty search, the wrong kind and a service that answers badly each give a plain message", async () => {
  const { get } = recorder(pixabay);
  await assert.rejects(searchStock("pixabay", "image", "flowers", 1, "  ", get), /Add your free Pixabay key in Settings to search it here, or open Pixabay in your browser/);
  await assert.rejects(searchStock("freesound", "audio", "rain", 1, "", get), /Add your free Freesound key in Settings/);
  await assert.rejects(searchStock("pexels", "image", "x", 1, "", get), /Add your free Pexels key in Settings/);
  await assert.rejects(searchStock("pixabay", "image", "   ", 1, "k", get), /Type something to search for/);
  await assert.rejects(searchStock("pixabay", "video", "x", 1, "k", get), /Pixabay has no video/);
  await assert.rejects(searchStock("freesound", "image", "x", 1, "k", get), /Freesound has no images/);
  await assert.rejects(searchStock("pixabay", "image", "x", 1, "k", recorder("[ERROR 400] \"key\" is invalid").get), /Pixabay did not answer/);
  await assert.rejects(searchStock("pexels", "image", "x", 1, "k", recorder("<html>").get), /Pexels did not answer/);
  const empty = await searchStock("pexels", "image", "zzzz", 1, "k", recorder(JSON.stringify({ total_results: 0, next_page: "", photos: [] })).get);
  assert.deepEqual(empty.hits, []);
  assert.equal(empty.hasMore, false);
});

test("Unsplash is told about a download, and nothing else is, and a failure to tell it is not an error", async () => {
  const { get, calls } = recorder("{}");
  const page = await searchStock("unsplash", "image", "flower", 1, "K", recorder(unsplash).get);
  await trackDownload(page.hits[0]!, "K", get);
  assert.match(calls[0]!.url, /photos\/eOLpJytrbsQ\/download/);
  await trackDownload(page.hits[0]!, "K", async () => { throw new Error("offline"); });
  for (const other of [(await run("pexels", "image", pexelsPhotos)).hits[0]!, (await run("pixabay", "image", pixabay)).hits[0]!]) await trackDownload(other, "k", get);
  assert.equal(calls.length, 1);
});

test("names, credit records, licence labels and times read well", async () => {
  const h = (await run("unsplash", "image", unsplash)).hits[0]!;
  assert.equal(nameFor(h), "unsplash-eOLpJytrbsQ-a white flower in the rain");
  assert.ok(nameFor({ ...h, title: "x".repeat(200) }).length <= 60);
  assert.deepEqual(creditFor(h), { provider: "unsplash", url: h.pageUrl, creator: "Jane Doe", creatorUrl: h.creatorUrl, licence: "Unsplash Licence", requiresCredit: true });
  assert.equal(creditFor((await run("freesound", "audio", freesound)).hits[0]!).provider, "freesound");
  assert.ok(searchUrl("pixabay", "image", "a b", 1, "k").includes("q=a%20b"));
  assert.equal(ccFromUrl("https://creativecommons.org/licenses/by/4.0/"), "CC BY 4.0");
  assert.equal(ccFromUrl("http://creativecommons.org/publicdomain/zero/1.0/"), "CC0 1.0");
  assert.equal(clock(65), "1:05");
  assert.equal(clock(0), "0:00");
});

test("settings keep all four keys, and a damaged or missing file means no keys", () => {
  const s = parseSettings(serializeSettings({ keys: { pixabay: "p", unsplash: "u", pexels: "x", freesound: "f" }, ai: emptyAi() }));
  assert.deepEqual(s.keys, { pixabay: "p", unsplash: "u", pexels: "x", freesound: "f" });
  const none = { pixabay: "", unsplash: "", pexels: "", freesound: "" };
  assert.deepEqual(parseSettings("").keys, none);
  assert.deepEqual(parseSettings("{not json").keys, none);
  assert.deepEqual(parseSettings('{"keys":{"pixabay":5}}').keys, none);
  assert.equal(parseSettings('{"keys":{"pixabay":"old"}}').keys.pexels, "", "settings saved before Pexels existed still load");
});
