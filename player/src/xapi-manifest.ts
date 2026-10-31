// tincan.xml for an xAPI package: the file an LRS or an LMS reads to learn what the course is called, what identifies it,
// and which file launches it. Used only when publishing, never by the player.

export interface TincanInput {
  title: string;
  language: string;
  /** The course's identifier (see courseActivityId in xapi.ts). */
  activityId: string;
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildTincanXml(input: TincanInput): string {
  const lang = xml(input.language);
  return `<?xml version="1.0" encoding="utf-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="${xml(input.activityId)}" type="http://adlnet.gov/expapi/activities/course">
      <name lang="${lang}">${xml(input.title)}</name>
      <description lang="${lang}">An interactive course made with OpenStage Author.</description>
      <launch lang="${lang}">index.html</launch>
    </activity>
  </activities>
</tincan>
`;
}
