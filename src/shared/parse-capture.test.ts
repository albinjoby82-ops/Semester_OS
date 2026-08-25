import { describe, expect, it } from "vitest";
import { parseCapture } from "./parse-capture";

/** Wednesday 9 September 2026, local noon. */
const wed = new Date(2026, 8, 9, 12, 0, 0);

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("parseCapture", () => {
  it("handles the brief's example", () => {
    const result = parseCapture("digital lab friday 1h", wed);
    expect(result.moduleCode).toBe("EEEN20050");
    expect(result.estimatedMinutes).toBe(60);
    expect(localDay(result.dueAt!)).toBe("2026-09-11"); // the coming Friday
    expect(result.title).toBe("lab");
    expect(result.areaId).toBe("university");
  });

  it("always returns a usable title when nothing is recognised", () => {
    const result = parseCapture("email Peter about the lab swap", wed);
    expect(result.title).toBe("email Peter about the lab swap");
    expect(result.moduleCode).toBeNull();
    expect(result.dueAt).toBeNull();
    expect(result.estimatedMinutes).toBeNull();
  });

  it("never returns an empty title, even if parsing eats everything", () => {
    const result = parseCapture("maths friday 2h", wed);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.moduleCode).toBe("MATH20290");
  });

  describe("modules", () => {
    it.each([
      ["solid state tutorial 4", "EEEN20070"],
      ["EEEN20020 homework 3", "EEEN20020"],
      ["circuits lab writeup", "EEEN20020"],
      ["maths problem sheet", "MATH20290"],
      ["leadership reflection", "SCI20020"],
      ["computer eng lab 5", "EEEN20010"],
    ])("recognises %s", (input, expected) => {
      expect(parseCapture(input, wed).moduleCode).toBe(expected);
    });

    it("prefers the longest matching alias", () => {
      // "solid state devices" must win over "solid state".
      const result = parseCapture("solid state devices revision", wed);
      expect(result.moduleCode).toBe("EEEN20070");
      expect(result.title).toBe("revision");
    });

    it("does not fire on a word that merely contains an alias", () => {
      expect(parseCapture("aftermath review", wed).moduleCode).toBeNull();
      expect(parseCapture("mathematics club", wed).moduleCode).toBeNull();
    });
  });

  describe("durations", () => {
    it.each([
      ["1h", 60],
      ["2 hours", 120],
      ["1.5h", 90],
      ["90m", 90],
      ["45 min", 45],
      ["30 minutes", 30],
    ])("parses %s", (input, expected) => {
      expect(parseCapture(`review ${input}`, wed).estimatedMinutes).toBe(
        expected,
      );
    });

    it("ignores a bare number with no unit", () => {
      expect(parseCapture("tutorial 4", wed).estimatedMinutes).toBeNull();
      expect(parseCapture("tutorial 4", wed).title).toBe("tutorial 4");
    });
  });

  describe("dates", () => {
    it("resolves tomorrow", () => {
      expect(localDay(parseCapture("lab tomorrow", wed).dueAt!)).toBe(
        "2026-09-10",
      );
    });

    it("resolves today", () => {
      expect(localDay(parseCapture("lab today", wed).dueAt!)).toBe(
        "2026-09-09",
      );
    });

    it("resolves the coming weekday", () => {
      // Wednesday -> Friday is 2 days away.
      expect(localDay(parseCapture("lab friday", wed).dueAt!)).toBe(
        "2026-09-11",
      );
      // Wednesday -> Monday wraps to next week.
      expect(localDay(parseCapture("lab monday", wed).dueAt!)).toBe(
        "2026-09-14",
      );
    });

    it("treats a weekday named on that day as today", () => {
      expect(localDay(parseCapture("lab wednesday", wed).dueAt!)).toBe(
        "2026-09-09",
      );
    });

    it("pushes 'next friday' a further week out", () => {
      expect(localDay(parseCapture("lab next friday", wed).dueAt!)).toBe(
        "2026-09-18",
      );
    });

    it("sets the due time to the end of the day", () => {
      const due = new Date(parseCapture("lab friday", wed).dueAt!);
      expect(due.getHours()).toBe(23);
      expect(due.getMinutes()).toBe(59);
    });
  });

  describe("areas", () => {
    it("recognises extracurricular areas", () => {
      expect(parseCapture("gaelforce CAD review", wed).areaId).toBe("gaelforce");
      expect(parseCapture("accio follow-up", wed).areaId).toBe("accio");
    });

    it("treats a module as university, ignoring any area word", () => {
      const result = parseCapture("maths tutorial", wed);
      expect(result.areaId).toBe("university");
    });

    it("leaves the area unset when nothing matches", () => {
      expect(parseCapture("buy milk", wed).areaId).toBeNull();
    });
  });

  describe("title cleanup", () => {
    it("strips consumed fragments and tidy words", () => {
      const result = parseCapture("circuits homework 3 due friday 90m", wed);
      expect(result.title).toBe("homework 3");
      expect(result.moduleCode).toBe("EEEN20020");
      expect(result.estimatedMinutes).toBe(90);
    });

    it("reports what it consumed so the user can see the inference", () => {
      const result = parseCapture("digital lab friday 1h", wed);
      expect(result.matched).toContain("digital");
      expect(result.matched).toContain("friday");
      expect(result.matched.some((m) => m.includes("1h"))).toBe(true);
    });

    it("trims stray punctuation left behind", () => {
      expect(parseCapture("maths, problem sheet", wed).title).toBe(
        "problem sheet",
      );
    });
  });
});
