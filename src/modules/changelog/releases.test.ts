import { describe, expect, it } from "vitest";
import {
  BASE_VERSION,
  CURRENT_RELEASE,
  NEXT_RELEASE,
  RELEASES,
  computeReleases,
  previewNextRelease,
  formatReleaseDate,
  releaseNotice,
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

describe("previewNextRelease", () => {
  const entries = [entry("2026-12-01", ["new"])]; // 2.10.0

  it("sem itens não há próxima versão", () => {
    expect(previewNextRelease([], entries, "2.9.0")).toBeNull();
  });

  it("só correções sobe o patch; novidade sobe o minor", () => {
    expect(
      previewNextRelease([{ kind: "fixed", text: "x" }], entries, "2.9.0")
        ?.version,
    ).toBe("2.10.1");
    expect(
      previewNextRelease([{ kind: "improved", text: "x" }], entries, "2.9.0")
        ?.version,
    ).toBe("2.11.0");
  });
});

// A main só recebe a próxima versão já fechada por `npm run release`
it.runIf(process.env.GITHUB_BASE_REF === "main")(
  "PR para a main: NEXT_RELEASE vazia (rode npm run release na develop)",
  () => {
    expect(NEXT_RELEASE).toEqual([]);
  },
);

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

describe("releaseNotice", () => {
  const current = { version: "2.11.0", date: "2026-11-03", changes: [{ kind: "new" as const, text: "a" }] };
  const upcoming = { version: "2.12.0", changes: [{ kind: "new" as const, text: "b" }, { kind: "fixed" as const, text: "c" }] };

  it("na produção avisa a versão atual", () => {
    const n = releaseNotice(current, upcoming, true);
    expect(n.key).toBe("2.11.0");
    expect(n.title).toMatch(/versão 2.11.0/);
    expect(n.date).toBe("2026-11-03");
  });

  it("fora da produção avisa de novo quando entra novidade em teste", () => {
    const a = releaseNotice(current, upcoming, false);
    const b = releaseNotice(current, { ...upcoming, changes: [...upcoming.changes, { kind: "fixed" as const, text: "d" }] }, false);
    expect(a.key).not.toBe(b.key);
    expect(a.title).toMatch(/em teste/);
  });

  it("sem nada em teste, avisa a versão atual", () => {
    expect(releaseNotice(current, null, false).key).toBe("2.11.0");
  });
});
