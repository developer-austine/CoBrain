import { describe, expect, it } from "vitest";
import {
  attributePeople,
  isPeopleQuestion,
  isRosterQuestion,
  namesFromDocument,
  namesInText,
  renderRoster,
  subjectTerms,
} from "../people";

const doc = (o: Partial<Parameters<typeof namesFromDocument>[0]> = {}) => ({
  text: "",
  source: "notion",
  title: "A page",
  displayAuthor: null,
  ...o,
});

describe("namesInText", () => {
  it("reads a Notion assignment property", () => {
    expect(namesInText("# Task\n## Details\nAssigned To: LYNN BITOK\nStatus: Doing")).toEqual([
      "LYNN BITOK",
    ]);
  });

  it("splits multi-person values on commas and 'and'", () => {
    expect(namesInText("Assigned To: Miss Kwara, LYNN BITOK and Elvis Kemoi")).toEqual([
      "Miss Kwara",
      "LYNN BITOK",
      "Elvis Kemoi",
    ]);
  });

  it("reads an authorship sign-off at the foot of a page", () => {
    expect(namesInText("...standards...\nHAPPY CODING!\nEdited by: Developer-Austine")).toEqual([
      "Developer-Austine",
    ]);
  });

  it("ignores placeholders rather than inventing a colleague", () => {
    expect(namesInText("Assigned To: Not stated\nOwner: Unassigned")).toEqual([]);
  });

  it("ignores an unresolved Notion user id", () => {
    expect(namesInText("Created by: 3f2b6c1a-9d4e-4f7a-8b2c-1e5d7a9c3f04")).toEqual([]);
  });

  it("ignores areas of responsibility listed under an ownership field", () => {
    // Documentation writes "Owner: billing, user management" to mean scope,
    // not people — these used to appear in the roster as colleagues.
    expect(namesInText("Owner: billing, user management, full control")).toEqual([]);
    expect(namesInText("Assigned To: all data.")).toEqual([]);
  });

  it("still accepts capitalised names and lowercase handles", () => {
    expect(namesInText("Assigned To: LYNN BITOK")).toEqual(["LYNN BITOK"]);
    expect(namesInText("Author: developer-austine")).toEqual(["developer-austine"]);
    expect(namesInText("Edited by: Developer-Austine")).toEqual(["Developer-Austine"]);
  });

  it("ignores a prose sentence that happens to start with a field name", () => {
    expect(
      namesInText("Owner: the team agreed this belongs to whoever picks it up next sprint")
    ).toEqual([]);
  });
});

describe("namesFromDocument", () => {
  it("treats an email sender as a correspondent, not a colleague", () => {
    expect(
      namesFromDocument(
        doc({ source: "gmail", displayAuthor: '"CodePen" <support@codepen.io>' })
      )
    ).toEqual([]);
  });

  it("counts a Notion page creator as a colleague", () => {
    expect(
      namesFromDocument(doc({ source: "notion", displayAuthor: "LYNN BITOK" }))
    ).toEqual([{ name: "LYNN BITOK", evidence: "author" }]);
  });

  it("ranks an explicit assignment as stronger evidence than authorship", () => {
    const names = namesFromDocument(
      doc({ text: "Assigned To: Elvis Kemoi", displayAuthor: "Marsoney Labs" })
    );
    expect(names).toEqual([
      { name: "Elvis Kemoi", evidence: "ownership" },
      { name: "Marsoney Labs", evidence: "author" },
    ]);
  });
});

describe("attributePeople", () => {
  it("collects each person's work across documents", () => {
    const people = attributePeople([
      doc({ title: "Admin analytic page", text: "Assigned To: LYNN BITOK" }),
      doc({ title: "Living Map", text: "Assigned To: Miss Kwara, LYNN BITOK" }),
    ]);

    expect(people.map((p) => p.name)).toEqual(["LYNN BITOK", "Miss Kwara"]);
    expect(people[0].items).toEqual(["Admin analytic page", "Living Map"]);
  });

  it("collapses spellings of the same person", () => {
    const people = attributePeople([
      doc({ title: "One", text: "Assigned To: LYNN BITOK" }),
      doc({ title: "Two", text: "Assigned To: Lynn Bitok" }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].items).toEqual(["One", "Two"]);
  });

  it("upgrades an author to an owner once work is assigned to them", () => {
    const people = attributePeople([
      doc({ title: "One", displayAuthor: "Elvis Kemoi" }),
      doc({ title: "Two", text: "Assigned To: Elvis Kemoi" }),
    ]);
    expect(people[0].evidence).toBe("ownership");
  });

  it("sorts people with assigned work above author-only names", () => {
    const people = attributePeople([
      doc({ title: "Workspace page", displayAuthor: "Marsoney Labs" }),
      doc({ title: "Task", text: "Assigned To: Awstine Jessy" }),
    ]);
    expect(people.map((p) => p.name)).toEqual(["Awstine Jessy", "Marsoney Labs"]);
  });
});

describe("isPeopleQuestion", () => {
  it.each([
    "who are the devs in the company?",
    "which engineers are on the admin page",
    "list the team",
  ])("detects %j", (q) => expect(isPeopleQuestion(q)).toBe(true));

  it.each([
    "what decisions were made about coding best practises?",
    "summarise the timetable proposal",
  ])("leaves %j alone", (q) => expect(isPeopleQuestion(q)).toBe(false));
});

describe("isRosterQuestion", () => {
  it.each([
    "who are the devs in the company?",
    "list the team",
    "who works here",
  ])("treats %j as a request for everyone", (q) => {
    expect(isPeopleQuestion(q) && isRosterQuestion(q)).toBe(true);
  });

  it.each([
    "When looking at the Notion page who made the edit of coding best practices.",
    "who owns the admin analytic page?",
    "whose task is the internship form",
  ])("treats %j as a request for one attribution", (q) => {
    expect(isPeopleQuestion(q)).toBe(true);
    expect(isRosterQuestion(q)).toBe(false);
  });

  it("keeps the subject of an attribution question", () => {
    expect(subjectTerms("who made the edit of coding best practices")).toEqual([
      "edit",
      "coding",
      "best",
      "practices",
    ]);
  });

  it("leaves nothing to narrow on a roster question", () => {
    expect(subjectTerms("who are the devs in the company?")).toEqual([]);
  });
});

describe("renderRoster", () => {
  it("leads with names and separates unverified authors", () => {
    const out = renderRoster(
      attributePeople([
        doc({ title: "Task", text: "Assigned To: Elvis Kemoi" }),
        doc({ title: "Page", displayAuthor: "Marsoney Labs" }),
      ])
    );
    expect(out.startsWith("**Elvis Kemoi**")).toBe(true);
    expect(out).toContain("Also appearing as document authors");
    expect(out).toContain("Marsoney Labs");
  });

  it("is empty when nobody was found", () => {
    expect(renderRoster([])).toBe("");
  });
});
