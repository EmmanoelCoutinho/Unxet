import { describe, expect, it } from "vitest";
import { isVideoFile } from "./videoFile";

describe("isVideoFile", () => {
  it.each([
    ["video/mp4", null],
    ["video/quicktime", "IMG_0001.MOV"],
    ["VIDEO/3GPP; codecs=x", null],
    [null, "apresentacao.mp4"],
    ["application/octet-stream", "gravacao.mov"],
    ["", "clip.webm"],
  ])("%s %s é vídeo", (mime, filename) => {
    expect(isVideoFile(mime, filename)).toBe(true);
  });

  it.each([
    ["application/pdf", "contrato.mp4"],
    ["image/jpeg", null],
    [null, "nota.pdf"],
    [null, null],
  ])("%s %s não é vídeo", (mime, filename) => {
    expect(isVideoFile(mime, filename)).toBe(false);
  });
});
