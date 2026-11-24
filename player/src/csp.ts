// The content security policy of a published course page. It is a rule the browser enforces: the page may load code, pictures, sound and frames only from
// the places listed here, so that if anything ever slipped a piece of script or a stray address into a course, the browser would refuse to run or fetch it.
//
// It is written into index.html by publish.ts as a <meta http-equiv="Content-Security-Policy"> tag, because a course is a folder of files that a learning
// system or a plain web server hands out, and the author does not control the headers it sends. Two directives can only be set by a header and are left
// out on purpose: `frame-ancestors` (a course has to be framed by the learning system, so it must not be restricted) and `sandbox`.
//
// What the page needs, found by reading the player: its own script (player.js) and style sheet (player.css); the pictures, sound and video of the course, which
// are files of the course; the project data in a <script type="application/json"> block, which is data and not code, so no rule applies to it; and, only when
// an author adds one, a YouTube or Vimeo player in a frame. The player makes no other request except the reports to a learning record store (xAPI and cmi5).
// It never evaluates a string as code, so `'unsafe-eval'` is not and must not be allowed, and it sets no style or script inline (its changes to a style go
// through the page's own style object, which the browser allows), so `'unsafe-inline'` is not allowed either. The tests in csp.test.ts hold all of that.

import { EMBED_ORIGINS } from "./blocks.ts";

/** Each directive, with a plain-words reason for what it lets through. The order is the order written to the page. */
export const DIRECTIVES: readonly { name: string; sources: readonly string[]; why: string }[] = [
  {
    name: "default-src", sources: ["'self'"],
    why: "Anything not named below may come only from the course's own folder. This is what covers fonts and anything else the player might one day ask for.",
  },
  {
    name: "script-src", sources: ["'self'"],
    why: "Only the course's own player.js may run. No script written into the page, and none from another site. The project data block is not a script, so it is not affected.",
  },
  {
    name: "style-src", sources: ["'self'"],
    why: "Only the course's own player.css. The player sets colours and sizes through the page's style object, which this rule does not stop, so no inline style is needed.",
  },
  {
    name: "img-src", sources: ["'self'", "data:"],
    why: "The course's own pictures. A picture written into a project file as text (a data: address) is allowed too, so one that an author's project names still shows. The player never writes one itself.",
  },
  {
    name: "media-src", sources: ["'self'", "blob:"],
    why: "The course's own narration, audio and video, and their captions files. Sound or video the browser holds in memory (blob:) is allowed too; the player does not make any today.",
  },
  {
    name: "connect-src", sources: ["https:", "http://localhost:*", "http://127.0.0.1:*"],
    why: "The player reports answers to a learning record store (xAPI and cmi5), whose address is only known when the course is launched. The player itself refuses an address that is not https, except on the learner's own computer, so this lists exactly those two. The address [::1] cannot be written in a policy.",
  },
  {
    name: "frame-src", sources: Object.values(EMBED_ORIGINS),
    why: "The only frames in a course are the YouTube and Vimeo players of an embed object. These are the two sites the player builds those addresses from, and no others.",
  },
  {
    name: "object-src", sources: ["'none'"],
    why: "No plug-ins (object, embed or applet). The player never uses one.",
  },
  {
    name: "base-uri", sources: ["'self'"],
    why: "A base tag, if one were ever slipped in, could not point the page's own file names at another site.",
  },
  {
    name: "form-action", sources: ["'self'"],
    why: "The certificate form is the only form, and it never sends anything (the player handles it on the page). A form could not send what a learner types to another site.",
  },
];

/** The policy as the one line a browser reads: the directives, each with its sources, separated by semicolons. */
export function contentSecurityPolicy(): string {
  return DIRECTIVES.map((d) => `${d.name} ${d.sources.join(" ")}`).join("; ");
}

/** The tag that goes in the page's head. It must come before anything it governs (the style sheet and the script), or the browser will not apply it to them. */
export function policyMetaTag(): string {
  return `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy()}">`;
}
