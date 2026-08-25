import { describe, expect, it } from "vitest";
import {
  classifyResource,
  escapeDriveQuery,
  extractWeekNumber,
  FOLDER_MIME,
  groupByType,
  groupByWeek,
  indexFile,
  type DriveFile,
  type IndexedResource,
} from "./drive";

const file = (over: Partial<DriveFile> = {}): DriveFile => ({
  id: "f1",
  name: "Week 3 slides.pdf",
  mimeType: "application/pdf",
  webViewLink: "https://drive.google.com/file/d/f1/view",
  ...over,
});

describe("classifyResource", () => {
  it("prefers the folder path over the filename", () => {
    // The recommended layout is a stronger signal than a vague filename.
    expect(classifyResource("week3.pdf", "EEEN20020/Labs")).toBe("lab");
    expect(classifyResource("week3.pdf", "EEEN20020/Slides")).toBe("slide");
    expect(classifyResource("week3.pdf", "EEEN20020/Notes")).toBe("notes");
  });

  it("falls back to the filename with no useful path", () => {
    expect(classifyResource("Lab 2 writeup.docx")).toBe("lab");
    expect(classifyResource("Homework 3.pdf")).toBe("assignment");
    expect(classifyResource("Lecture 4 deck.pptx")).toBe("slide");
    expect(classifyResource("Formula sheet.pdf")).toBe("formula_sheet");
    expect(classifyResource("Chapter 2 reading.pdf")).toBe("reading");
  });

  it("recognises a problem sheet as assessed work", () => {
    expect(classifyResource("Problem sheet 2.pdf")).toBe("assignment");
  });

  it("returns other rather than guessing", () => {
    expect(classifyResource("scan_0012.jpg")).toBe("other");
    expect(classifyResource("untitled.pdf")).toBe("other");
  });
});

describe("extractWeekNumber", () => {
  it.each([
    ["Week 3 slides.pdf", 3],
    ["wk7 notes.pdf", 7],
    ["w03 lab.pdf", 3],
    ["week-11-tutorial.pdf", 11],
    ["Week12.pdf", 12],
  ])("reads %s as week %i", (name, expected) => {
    expect(extractWeekNumber(name)).toBe(expected);
  });

  it("does not treat a bare number as a week", () => {
    // "Lab 2" is lab two, not week two.
    expect(extractWeekNumber("Lab 2.pdf")).toBeNull();
    expect(extractWeekNumber("Assignment 4.docx")).toBeNull();
  });

  it("rejects implausible week numbers", () => {
    expect(extractWeekNumber("week 99")).toBeNull();
    expect(extractWeekNumber("week 0")).toBeNull();
  });

  it("returns null when there is no week at all", () => {
    expect(extractWeekNumber("Formula sheet.pdf")).toBeNull();
  });
});

describe("indexFile", () => {
  it("indexes a file with type, week and link", () => {
    expect(indexFile(file(), "EEEN20020/Slides")).toEqual({
      googleDriveFileId: "f1",
      title: "Week 3 slides.pdf",
      type: "slide",
      weekNumber: 3,
      url: "https://drive.google.com/file/d/f1/view",
    });
  });

  it("skips folders", () => {
    expect(indexFile(file({ mimeType: FOLDER_MIME }))).toBeNull();
  });

  it("prefers the week in the filename over the folder", () => {
    // A week-3 file inside a Week 1 folder is about week 3.
    expect(
      indexFile(file({ name: "Week 3 notes.pdf" }), "EEEN20020/Week 1")
        ?.weekNumber,
    ).toBe(3);
  });

  it("falls back to the folder week when the filename has none", () => {
    expect(
      indexFile(file({ name: "notes.pdf" }), "EEEN20020/Week 5")?.weekNumber,
    ).toBe(5);
  });

  it("tolerates a missing link", () => {
    expect(indexFile(file({ webViewLink: undefined }))?.url).toBeNull();
  });
});

describe("grouping", () => {
  const resources: IndexedResource[] = [
    { googleDriveFileId: "a", title: "B slides", type: "slide", weekNumber: 2, url: null },
    { googleDriveFileId: "b", title: "A slides", type: "slide", weekNumber: 1, url: null },
    { googleDriveFileId: "c", title: "Lab 1", type: "lab", weekNumber: 1, url: null },
    { googleDriveFileId: "d", title: "Loose file", type: "other", weekNumber: null, url: null },
  ];

  it("groups by type in display order", () => {
    const groups = groupByType(resources);
    expect(groups.map((g) => g.type)).toEqual(["slide", "lab", "other"]);
  });

  it("sorts items alphabetically within a type", () => {
    const slides = groupByType(resources).find((g) => g.type === "slide");
    expect(slides?.items.map((i) => i.title)).toEqual(["A slides", "B slides"]);
  });

  it("omits empty types entirely", () => {
    expect(groupByType(resources).some((g) => g.type === "notes")).toBe(false);
  });

  it("groups by week with undated files last", () => {
    expect(groupByWeek(resources).map((g) => g.weekNumber)).toEqual([1, 2, null]);
  });

  it("handles an empty set", () => {
    expect(groupByType([])).toEqual([]);
    expect(groupByWeek([])).toEqual([]);
  });
});

describe("escapeDriveQuery", () => {
  it("escapes quotes so a folder name cannot break the query", () => {
    expect(escapeDriveQuery("Bob's folder")).toBe("Bob\\'s folder");
  });

  it("escapes backslashes before quotes", () => {
    expect(escapeDriveQuery("a\\b")).toBe("a\\\\b");
  });
});
