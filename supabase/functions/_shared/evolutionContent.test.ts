import { describe, expect, it } from "vitest";
import {
  UNSUPPORTED_TEXT,
  UNSUPPORTED_TEXT_FROM_ME,
  isProtocolOnlyMessage,
  mediaFilename,
  mediaMimeType,
  parseEvolutionContent,
  unwrapEvolutionMessage,
} from "./evolutionContent";

const ctx = { messageContextInfo: { deviceListMetadata: {} } };
const image = { mimetype: "image/jpeg", caption: "Filtro", url: "https://mmg.whatsapp.net/x" };

describe("unwrapEvolutionMessage", () => {
  it("abre foto de álbum, temporária e visualização única", () => {
    expect(unwrapEvolutionMessage({ associatedChildMessage: { message: { imageMessage: image } }, ...ctx }))
      .toEqual({ imageMessage: image });
    expect(unwrapEvolutionMessage({ ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: image } } } } }))
      .toEqual({ imageMessage: image });
  });

  it("mensagem comum fica como veio", () => {
    const msg = { conversation: "oi", ...ctx };
    expect(unwrapEvolutionMessage(msg)).toBe(msg);
  });
});

describe("isProtocolOnlyMessage", () => {
  it.each([
    [{ albumMessage: { expectedImageCount: 3 }, ...ctx }],
    [{ secretEncryptedMessage: { secretEncType: 2 }, ...ctx }],
    [{ protocolMessage: { type: 0 } }],
    [{ ephemeralMessage: { message: { protocolMessage: { type: 0 } } } }],
    [{ ...ctx }],
  ])("%j é ignorada", (msg) => {
    expect(isProtocolOnlyMessage(msg)).toBe(true);
  });

  it("foto de álbum não é ignorada", () => {
    expect(isProtocolOnlyMessage({ associatedChildMessage: { message: { imageMessage: image } }, ...ctx })).toBe(false);
  });
});

describe("parseEvolutionContent", () => {
  it("foto de álbum vira imagem e baixa só o conteúdo", () => {
    const content = parseEvolutionContent({ associatedChildMessage: { message: { imageMessage: image } }, ...ctx }, "ID1");
    expect(content).toMatchObject({
      messageType: "image",
      text: "Filtro",
      needsMediaFetch: true,
      mediaMessage: { imageMessage: image },
    });
  });

  it("figurinha vira figurinha webp", () => {
    const content = parseEvolutionContent({ stickerMessage: { mimetype: "image/webp" } }, "ID2");
    expect(content).toMatchObject({
      messageType: "sticker",
      needsMediaFetch: true,
      fallbackFilename: "figurinha-ID2.webp",
      fallbackMimeType: "image/webp",
    });
  });

  it("vídeo redondo vira anexo de vídeo", () => {
    const content = parseEvolutionContent({ ptvMessage: { mimetype: "video/mp4" } }, "ID3");
    expect(content).toMatchObject({
      messageType: "document",
      mediaMessage: { videoMessage: { mimetype: "video/mp4" } },
      fallbackFilename: "video-ID3.mp4",
    });
  });

  it("áudio de visualização única", () => {
    const content = parseEvolutionContent({ viewOnceMessageV2Extension: { message: { audioMessage: { ptt: true } } } }, "ID4");
    expect(content).toMatchObject({ messageType: "audio", needsMediaFetch: true });
  });

  it("lista de opções mostra as linhas", () => {
    const content = parseEvolutionContent({
      listMessage: {
        buttonText: "Clique aqui:",
        description: "Selecione o setor com qual deseja falar.",
        footerText: "Navegue e selecione uma das opções.",
        sections: [{
          rows: [
            { title: "🔎Consulta de Status", description: "Consulta Status de Guia", rowId: "1" },
            { title: "↩️ Voltar", rowId: "3" },
          ],
        }],
      },
      ...ctx,
    }, "ID5");
    expect(content.messageType).toBe("text");
    expect(content.text).toBe([
      "Selecione o setor com qual deseja falar.",
      "• 🔎Consulta de Status - Consulta Status de Guia\n• ↩️ Voltar",
      "📋 Clique aqui:\n_Navegue e selecione uma das opções._",
    ].join("\n\n"));
  });

  it("modelo mostra o texto e os botões", () => {
    const content = parseEvolutionContent({
      templateMessage: {
        hydratedTemplate: {
          hydratedTitleText: "",
          hydratedContentText: "Sua cobrança vence amanhã.",
          hydratedButtons: [{ urlButton: { displayText: "Pagar", url: "https://pague.example" } }],
        },
      },
    }, "ID6");
    expect(content).toMatchObject({
      messageType: "text",
      text: "Sua cobrança vence amanhã.\n\n🔘 Pagar - https://pague.example",
    });
  });

  it("modelo com imagem no cabeçalho baixa a imagem", () => {
    const content = parseEvolutionContent({
      templateMessage: { hydratedTemplate: { hydratedContentText: "Promoção", imageMessage: image } },
    }, "ID7");
    expect(content).toMatchObject({ messageType: "image", text: "Promoção", mediaMessage: { imageMessage: image } });
  });

  it("mensagem interativa mostra o corpo e ignora botão de pagamento", () => {
    const content = parseEvolutionContent({
      interactiveMessage: {
        body: { text: "Este é um número para envio de mensagens automáticas." },
        nativeFlowMessage: {
          buttons: [
            { name: "payment_request", buttonParamsJson: "{\"payment_setting\":{}}" },
            { name: "cta_url", buttonParamsJson: "{\"display_text\":\"Abrir site\",\"url\":\"https://site.example\"}" },
          ],
        },
      },
    }, "ID8");
    expect(content.text).toBe("Este é um número para envio de mensagens automáticas.\n\n🔘 Abrir site - https://site.example");
  });

  describe("Pix", () => {
    const code =
      "00020101021226900014br.gov.bcb.pix2568pix.exemplo.com/loc/AbC123520400005303986" +
      "5802BR5913LOJA EXEMPLO6009SAO PAULO62070503***6304ABCD";
    const pixButton = (params: Record<string, unknown>) => ({
      interactiveMessage: {
        body: { text: code },
        nativeFlowMessage: {
          buttons: [{ name: "payment_request", buttonParamsJson: JSON.stringify(params) }],
          messageVersion: 3,
        },
      },
    });

    it("copia e cola: mostra só o código, uma vez", () => {
      const content = parseEvolutionContent(pixButton({
        copy_code: code,
        display_text: "‎Copiar código Pix",
        payment_setting: { pix_dynamic_code: { code }, type: "pix_dynamic_code" },
        payment_settings: [{ pix_dynamic_code: { code }, type: "pix_dynamic_code" }],
        type: "PAYMENT_REQUEST",
      }), "PIX1");
      expect(content).toMatchObject({ messageType: "text", text: code });
    });

    it("copia e cola com valor", () => {
      const content = parseEvolutionContent(pixButton({
        currency: "BRL",
        total_amount: { value: 5400, offset: 100 },
        payment_settings: [{ pix_dynamic_code: { code }, type: "pix_dynamic_code" }],
      }), "PIX2");
      // O Intl separa "R$" do valor com espaço não separável
      expect(content.text.replace(/ /g, " ")).toBe(`Valor: R$ 54,00\n${code}`);
    });

    it("chave Pix", () => {
      const content = parseEvolutionContent({
        interactiveMessage: {
          nativeFlowMessage: {
            buttons: [{
              name: "payment_info",
              buttonParamsJson: JSON.stringify({
                payment_settings: [{
                  type: "pix_static_code",
                  pix_static_code: { key: "12.345.678/0001-90", key_type: "CNPJ", merchant_name: "Loja Exemplo" },
                }],
              }),
            }],
          },
        },
      }, "PIX3");
      expect(content.text).toBe("Chave Pix (CNPJ): 12.345.678/0001-90\nLoja Exemplo");
    });
  });

  it("resposta a botão nativo vira resposta interativa", () => {
    const content = parseEvolutionContent({
      interactiveResponseMessage: {
        body: { text: "Sim" },
        nativeFlowResponseMessage: { name: "quick_reply", paramsJson: "{\"id\":\"opt_1\"}" },
      },
    }, "ID9");
    expect(content).toMatchObject({
      messageType: "interactive",
      text: "Sim",
      interactive: { kind: "button_reply", selectedId: "opt_1", selectedTitle: "Sim" },
    });
  });

  it("resposta de lista mantém o tipo list_reply", () => {
    const content = parseEvolutionContent({
      listResponseMessage: { title: "Financeiro", singleSelectReply: { selectedRowId: "2" } },
    }, "ID10");
    expect(content.interactive).toEqual({ kind: "list_reply", selectedId: "2", selectedTitle: "Financeiro" });
  });

  it("enquete lista as opções", () => {
    const content = parseEvolutionContent({
      pollCreationMessageV3: { name: "Melhor horário?", options: [{ optionName: "Manhã" }, { optionName: "Tarde" }] },
    }, "ID11");
    expect(content.text).toBe("📊 Enquete: Melhor horário?\n• Manhã\n• Tarde");
  });

  it("evento e convite de grupo viram texto", () => {
    expect(parseEvolutionContent({ eventMessage: { name: "Reunião", description: "Pauta" } }, "E").text)
      .toBe("📅 Evento: Reunião\nPauta");
    expect(parseEvolutionContent({ groupInviteMessage: { groupName: "Clientes", inviteCode: "AbC" } }, "G").text)
      .toBe("👥 Convite para o grupo Clientes\nhttps://chat.whatsapp.com/AbC");
  });

  it("texto vazio continua texto", () => {
    expect(parseEvolutionContent({ conversation: "" }, "T")).toMatchObject({ messageType: "text", text: "" });
  });

  it("tipo desconhecido mostra o aviso e diz qual era", () => {
    const content = parseEvolutionContent({ algoNovoMessage: {}, ...ctx }, "X");
    expect(content).toMatchObject({ messageType: "text", text: UNSUPPORTED_TEXT, unsupported: ["algoNovoMessage"] });
    expect(parseEvolutionContent({ algoNovoMessage: {} }, "X", { fromMe: true }).text).toBe(UNSUPPORTED_TEXT_FROM_ME);
  });
});

describe("tipo e nome do arquivo", () => {
  it("lê da própria mensagem", () => {
    expect(mediaMimeType({ imageMessage: image })).toBe("image/jpeg");
    expect(mediaMimeType({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf" } } } }))
      .toBe("application/pdf");
    expect(mediaFilename({ documentMessage: { fileName: "nota.pdf" } })).toBe("nota.pdf");
    expect(mediaFilename({ imageMessage: image })).toBeUndefined();
  });
});
