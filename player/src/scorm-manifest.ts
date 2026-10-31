// imsmanifest.xml for a SCORM 1.2 or SCORM 2004 package containing one SCO: the whole course.

import { PASSING_PERCENT } from "./scorm.ts";

export interface ManifestInput {
  title: string;
  /** Files in the package, as forward-slash paths relative to the package root. */
  files: string[];
  /** True if the course has a graded quiz, so the LMS is told the mastery score. */
  graded: boolean;
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Identifiers must be valid XML names: letters, digits, hyphens, starting with a letter. */
export function manifestId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `openstage-${slug || "course"}`;
}

export function buildManifest(input: ManifestInput): string {
  const id = manifestId(input.title);
  const files = [...input.files].sort().map((f) => `      <file href="${xml(f)}"/>`).join("\n");
  const mastery = input.graded ? `\n        <adlcp:masteryscore>${PASSING_PERCENT}</adlcp:masteryscore>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org-1">
    <organization identifier="org-1">
      <title>${xml(input.title)}</title>
      <item identifier="item-1" identifierref="res-1" isvisible="true">
        <title>${xml(input.title)}</title>${mastery}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
${files}
    </resource>
  </resources>
</manifest>
`;
}

/**
 * imsmanifest.xml for SCORM 2004 (4th edition), one SCO, the whole course. Two things differ from 1.2 beyond the namespaces:
 *  - The pass mark is a fraction (0.8) on the primary objective, and the LMS works success out from the scaled score.
 *  - deliveryControls tell the LMS that the course itself reports completion and success. Without them an LMS may mark the
 *    course complete the moment the learner leaves, whatever the course said.
 * The elements inside imsss:sequencing must come in the order the standard fixes: objectives, then deliveryControls.
 */
export function buildManifest2004(input: ManifestInput): string {
  const id = manifestId(input.title);
  const files = [...input.files].sort().map((f) => `      <file href="${xml(f)}"/>`).join("\n");
  const objectives = input.graded
    ? `
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="primary-objective" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${PASSING_PERCENT / 100}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>
          </imsss:objectives>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="org-1">
    <organization identifier="org-1" structure="hierarchical">
      <title>${xml(input.title)}</title>
      <item identifier="item-1" identifierref="res-1" isvisible="true">
        <title>${xml(input.title)}</title>
        <imsss:sequencing>${objectives}
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>
        </imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res-1" type="webcontent" adlcp:scormType="sco" href="index.html">
${files}
    </resource>
  </resources>
</manifest>
`;
}
