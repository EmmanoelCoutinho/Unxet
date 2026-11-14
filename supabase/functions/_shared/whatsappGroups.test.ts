import { describe, expect, it } from "vitest";
import {
  GROUP_INFO_REFRESH_MS,
  evolutionRecipient,
  groupInfoIsStale,
  groupPicKey,
  groupSender,
  isGroupJid,
  parseGroupInfo,
} from "./whatsappGroups";

describe("isGroupJid", () => {
  it("reconhece só JID de grupo", () => {
    expect(isGroupJid("120363012345678901@g.us")).toBe(true);
    expect(isGroupJid("5511999998888@s.whatsapp.net")).toBe(false);
    expect(isGroupJid("123@lid")).toBe(false);
    expect(isGroupJid(null)).toBe(false);
  });
});

describe("groupSender", () => {
  it("usa o telefone do participantAlt quando o participante vem como LID", () => {
    expect(
      groupSender({ participant: "98765432101234@lid", participantAlt: "5511999998888@s.whatsapp.net" }),
    ).toEqual({ phone: "5511999998888", lid: "98765432101234@lid", jid: "98765432101234@lid" });
  });

  it("aceita participantPn e participant no formato de telefone", () => {
    expect(groupSender({ participant: "x@lid", participantPn: "5511988887777@s.whatsapp.net" }).phone).toBe(
      "5511988887777",
    );
    expect(groupSender({ participant: "5511977776666@s.whatsapp.net" })).toEqual({
      phone: "5511977776666",
      lid: null,
      jid: "5511977776666@s.whatsapp.net",
    });
  });

  it("ignora o sufixo de aparelho no JID", () => {
    expect(groupSender({ participant: "5511977776666:12@s.whatsapp.net" }).phone).toBe("5511977776666");
  });

  it("sem número conhecido devolve só o LID", () => {
    expect(groupSender({ participant: "98765432101234@lid" })).toEqual({
      phone: null,
      lid: "98765432101234@lid",
      jid: "98765432101234@lid",
    });
    expect(groupSender(undefined)).toEqual({ phone: null, lid: null, jid: null });
  });
});

describe("evolutionRecipient", () => {
  it("conversa de grupo envia para o JID do grupo", () => {
    expect(
      evolutionRecipient({ whatsapp_groups: { jid: "120363@g.us" }, contacts: null }),
    ).toEqual({ number: "120363@g.us", remoteJid: "120363@g.us", isGroup: true });
  });

  it("conversa de cliente envia para o número", () => {
    expect(evolutionRecipient({ contacts: { phone: "+55 (11) 99999-8888" } })).toEqual({
      number: "5511999998888",
      remoteJid: "5511999998888@s.whatsapp.net",
      isGroup: false,
    });
  });

  it("sem grupo e sem telefone devolve null", () => {
    expect(evolutionRecipient({ contacts: { phone: null } })).toBeNull();
  });
});

describe("groupInfoIsStale", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");

  it("grupo novo ou sem nome precisa buscar", () => {
    expect(groupInfoIsStale(null, now)).toBe(true);
    expect(groupInfoIsStale({ name: null, info_synced_at: new Date(now).toISOString() }, now)).toBe(true);
  });

  it("respeita o intervalo de atualização", () => {
    const recent = new Date(now - 60_000).toISOString();
    const old = new Date(now - GROUP_INFO_REFRESH_MS).toISOString();
    expect(groupInfoIsStale({ name: "Equipe", info_synced_at: recent }, now)).toBe(false);
    expect(groupInfoIsStale({ name: "Equipe", info_synced_at: old }, now)).toBe(true);
  });
});

describe("parseGroupInfo", () => {
  it("lê nome e foto nos formatos da Evolution", () => {
    expect(parseGroupInfo({ id: "1@g.us", subject: " Vendas ", pictureUrl: "https://pps/x.jpg" })).toEqual({
      name: "Vendas",
      pictureUrl: "https://pps/x.jpg",
    });
    expect(parseGroupInfo([{ subject: "Suporte" }])).toEqual({ name: "Suporte", pictureUrl: null });
    expect(parseGroupInfo(null)).toEqual({ name: null, pictureUrl: null });
  });
});

describe("groupPicKey", () => {
  it("gera uma pasta própria para o grupo", () => {
    expect(groupPicKey("120363012345678901@g.us")).toBe("group-120363012345678901");
    expect(groupPicKey("5511999-1600000000@g.us")).toBe("group-5511999-1600000000");
  });
});
