// cmi5.xml for a cmi5 package: the course structure an LMS reads to learn what the course is called, what identifies it, which file launches it, and
// what the learner has to do for the LMS to count it as done. Used only when publishing, never by the player.
//
// A course made here is one assignable unit (AU). It asks to be launched in any window, and for the learner to complete it, and when it holds a scored
// question to pass it as well, with the same 80 percent pass mark every other package carries. The identifiers are addresses (IRIs) that stay the
// same each time the course is published, so a learner's record adds up across versions (see courseActivityId in xapi.ts). The LMS makes the
// activity id each launch uses itself, and the course takes it from the address it was opened with.
//
// Written to CourseStructure.xsd of cmi5 Quartz (https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd): the element order is the one it requires.

import { PASSING_PERCENT } from "./scorm.ts";

export interface Cmi5Input {
  title: string;
  language: string;
  /** The course's identifier (see courseActivityId in xapi.ts). The unit's own is made from it. */
  courseId: string;
  /** True if the course has a graded quiz: the learner must then pass as well as complete, and the LMS is told the mastery score. */
  graded: boolean;
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The id of the one unit in the course. */
export const unitId = (courseId: string): string => `${courseId}/au/1`;

export function buildCmi5Xml(input: Cmi5Input): string {
  const lang = xml(input.language);
  const title = xml(input.title);
  const description = "An interactive course made with OpenStage Author.";
  const mastery = input.graded ? ` masteryScore="${PASSING_PERCENT / 100}"` : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="${xml(input.courseId)}">
    <title><langstring lang="${lang}">${title}</langstring></title>
    <description><langstring lang="${lang}">${description}</langstring></description>
  </course>
  <au id="${xml(unitId(input.courseId))}" moveOn="${input.graded ? "CompletedAndPassed" : "Completed"}" launchMethod="AnyWindow"${mastery}>
    <title><langstring lang="${lang}">${title}</langstring></title>
    <description><langstring lang="${lang}">${description}</langstring></description>
    <url>index.html</url>
  </au>
</courseStructure>
`;
}
