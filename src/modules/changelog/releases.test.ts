import { describe, expect, it } from "vitest";
import {
  BASE_VERSION,
  CURRENT_RELEASE,
  RELEASES,
  computeReleases,
  formatReleaseDate,
  type ReleaseEntry,
} from "./releases";

const entry = (
  date: string,
  kinds: ("new" | "improved" | "fixed")[],
  major = false,
): ReleaseEntry => ({
  date,
  major,
  changes: kinds.map((kind) => ({ kind, text: `${kind} ${date}` })),
});

describe("computeReleases", () => {
  it("numera da mais antiga para a mais nova, devolvendo a mais nova primeiro", () => {
    const releases = computeReleases(
      [
        entry("2026-12-05", ["new"], true),
        entry("2026-12-04", ["fixed"]),
        entry("2026-12-03", ["improved", "fixed"]),
        entry("2026-12-02", ["fixed"]),
        entry("2026-12-01", ["new"]),
      ],
      "2.9.0",
    );
    expect(releases.map((r) => r.version)).toEqual([
      "3.0.0",
      "2.11.1",
      "2.11.0",
      "2.10.1",
      "2.10.0",
    ]);
  });

  it("não altera a lista original", () => {
    const entries = [entry("2026-12-01", ["fixed"])];
    computeReleases(entries, "1.0.0");
    expect(entries[0]).not.toHaveProperty("version");
  });
});

describe("lista publicada", () => {
  it("a versão atual é a primeira e fica acima da base", () => {
    expect(CURRENT_RELEASE).toBe(RELEASES[0]);
    expect(CURRENT_RELEASE.version).not.toBe(BASE_VERSION);
  });

  it("datas em ordem, da mais nova para a mais antiga", () => {
    const dates = RELEASES.map((r) => r.date);
    expect(dates).toEqual([...dates].sort().reverse());
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

it("formatReleaseDate", () => {
  expect(formatReleaseDate("2026-11-02")).toBe("02/11/2026");
});
