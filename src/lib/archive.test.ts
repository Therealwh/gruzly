import { describe, expect, it } from "vitest";
import { isArchiveName } from "./archive";

describe("isArchiveName", () => {
  it("recognizes supported archive suffixes", () => {
    for (const name of ["a.zip", "a.7z", "a.tar", "a.tar.gz", "a.tgz", "a.gz", "a.rar", "REPORT.ZIP"]) {
      expect(isArchiveName(name)).toBe(true);
    }
  });

  it("ignores other files and missing names", () => {
    for (const name of ["a.txt", "a.zip.part", "archive", "a.tar.bz2", "", null, undefined]) {
      expect(isArchiveName(name)).toBe(false);
    }
  });
});
