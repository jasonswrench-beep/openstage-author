// A PowerPoint file is a zip file of parts, and each part can have relationships that say what it uses: this slide uses that picture,
// that layout, that link. This opens the zip and follows the relationships.

import { readZip } from "../../../player/src/unzip.ts";
import { parseXml, type XmlNode } from "./xml.ts";

export interface Rel {
  id: string;
  /** The end of the relationship type, such as "slide", "image", "slideLayout", "hyperlink". */
  kind: string;
  /** The part this points at, as a part name (no leading slash), or the address for an outside link. */
  target: string;
  external: boolean;
}

const decoder = new TextDecoder("utf-8");

/** Join a relationship's target to the folder of the part that has it: "../media/a.png" from "ppt/slides" is "ppt/media/a.png". */
export function resolveTarget(partName: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = partName.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }
  return parts.join("/");
}

export class Pkg {
  private readonly files: Record<string, Uint8Array>;
  private readonly xmlCache = new Map<string, XmlNode | undefined>();
  private readonly relCache = new Map<string, Rel[]>();

  constructor(files: Record<string, Uint8Array>) {
    this.files = files;
  }

  has(name: string): boolean {
    return name in this.files;
  }

  bytes(name: string): Uint8Array | undefined {
    return this.files[name];
  }

  names(): string[] {
    return Object.keys(this.files);
  }

  /** A part read as XML, or undefined if it is not there. A part that is there but not well-formed throws. */
  xml(name: string): XmlNode | undefined {
    if (this.xmlCache.has(name)) return this.xmlCache.get(name);
    const raw = this.files[name];
    const node = raw ? parseXml(decoder.decode(raw)) : undefined;
    this.xmlCache.set(name, node);
    return node;
  }

  /** What a part uses, from its relationships part. */
  rels(part: string): Rel[] {
    const cached = this.relCache.get(part);
    if (cached) return cached;
    const slash = part.lastIndexOf("/");
    const relsName = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
    const root = this.xml(relsName);
    const out: Rel[] = (root?.children ?? [])
      .filter((r) => r.name === "Relationship" && r.attrs["Id"] && r.attrs["Target"])
      .map((r) => {
        const external = r.attrs["TargetMode"] === "External";
        const type = r.attrs["Type"] ?? "";
        return {
          id: r.attrs["Id"]!,
          kind: type.slice(type.lastIndexOf("/") + 1),
          target: external ? r.attrs["Target"]! : resolveTarget(part, r.attrs["Target"]!),
          external,
        };
      });
    this.relCache.set(part, out);
    return out;
  }

  rel(part: string, id: string | undefined): Rel | undefined {
    return id === undefined ? undefined : this.rels(part).find((r) => r.id === id);
  }

  relOfKind(part: string, kind: string): Rel | undefined {
    return this.rels(part).find((r) => r.kind === kind);
  }
}

/** Open a PowerPoint file. Throws a plain sentence if it is not a PowerPoint presentation. */
export function openDeck(bytes: Uint8Array): Pkg {
  const pkg = new Pkg(readZip(bytes));
  if (!pkg.has("ppt/presentation.xml")) {
    throw new Error(pkg.has("[Content_Types].xml")
      ? "That file is not a PowerPoint presentation (.pptx). An older .ppt file has to be saved as .pptx in PowerPoint first."
      : "That file is not a PowerPoint presentation (.pptx).");
  }
  return pkg;
}
