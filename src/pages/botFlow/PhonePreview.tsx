import {
  CameraIcon,
  ChevronLeftIcon,
  MicIcon,
  PhoneIcon,
  PlusIcon,
  RotateCcwIcon,
  VideoIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BOT_MENU_MAX_OPTIONS,
  BOT_OPTION_LABEL_MAX_LENGTH,
  type DepartmentRow,
  type TagRow,
} from "../../types/bots";
import { optionsOf, type FlowOption, type FlowState } from "./flowModel";

type Entry =
  | { from: "stage"; stageId: string }
  | { from: "bot"; text: string }
  | { from: "client"; text: string }
  | { from: "system"; text: string };

const bubble =
  "max-w-[88%] whitespace-pre-line rounded-[10px] px-2.5 py-2 text-[13px] leading-[1.45] text-[#111B21] shadow-[0_1px_0_rgba(0,0,0,0.08)]";

// Simulação local: mostra o que o cliente veria, sem enviar nada
export const PhonePreview = ({
  state,
  stageId,
  rootStageId,
  companyName,
  startMessage,
  departments,
  tags,
  onNavigate,
}: {
  state: FlowState;
  stageId: string;
  rootStageId: string | null;
  companyName: string;
  startMessage: string;
  departments: DepartmentRow[];
  tags: TagRow[];
  onNavigate: (stageId: string) => void;
}) => {
  const [trail, setTrail] = useState<Entry[]>([{ from: "stage", stageId }]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Abrir outra etapa pelo mapa recomeça a conversa a partir dela
  useEffect(() => {
    setTrail((prev) => {
      const lastStage = [...prev].reverse().find((e) => e.from === "stage");
      if (lastStage && lastStage.from === "stage" && lastStage.stageId === stageId) {
        return prev;
      }
      return [{ from: "stage", stageId }];
    });
  }, [stageId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [trail]);

  const restart = () => setTrail([{ from: "stage", stageId }]);

  const tap = (o: FlowOption) => {
    const next: Entry[] = [...trail, { from: "client", text: o.label.trim() || "(sem texto)" }];
    const tag = o.tagId ? tags.find((t) => t.id === o.tagId) : null;
    if (tag) next.push({ from: "system", text: `Etiqueta “${tag.name ?? ""}” adicionada ao cliente` });
    const reply = o.reply.trim();
    let navigateTo: string | null = null;

    if (!o.action) {
      next.push({ from: "system", text: "Este botão ainda não faz nada" });
    } else if (o.action === "stage") {
      if (o.target && state.stages.some((s) => s.id === o.target)) {
        if (reply) next.push({ from: "bot", text: reply });
        next.push({ from: "stage", stageId: o.target });
        navigateTo = o.target;
      } else {
        next.push({ from: "system", text: "Este botão ainda não tem etapa escolhida" });
      }
    } else if (o.action === "human") {
      if (reply) next.push({ from: "bot", text: reply });
      const dept = departments.find((d) => d.id === o.departmentId);
      next.push({
        from: "system",
        text: dept ? `Conversa passada para o setor ${dept.name}` : "Conversa passada para um atendente",
      });
    } else if (o.action === "message") {
      if (reply) next.push({ from: "bot", text: reply });
      next.push({ from: "stage", stageId: o.stageId });
    } else {
      if (reply) next.push({ from: "bot", text: reply });
      next.push({ from: "system", text: "Bot encerrado" });
    }

    setTrail(next);
    if (navigateTo) onNavigate(navigateTo);
  };

  const showStartMessage =
    !!startMessage.trim() && trail[0]?.from === "stage" && trail[0].stageId === rootStageId;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-bold text-slate-900">Como o cliente vê</div>
          <div className="mt-0.5 text-xs text-slate-500">Toque nos botões para testar</div>
        </div>
        <button
          type="button"
          onClick={restart}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RotateCcwIcon className="h-3.5 w-3.5" />
          Recomeçar
        </button>
      </div>

      <div className="relative mx-auto w-full max-w-[340px]">
        <div aria-hidden className="absolute -left-[3px] top-[118px] h-[30px] w-1 rounded-l bg-[#3A3A3C]" />
        <div aria-hidden className="absolute -left-[3px] top-[172px] h-14 w-1 rounded-l bg-[#3A3A3C]" />
        <div aria-hidden className="absolute -left-[3px] top-[240px] h-14 w-1 rounded-l bg-[#3A3A3C]" />
        <div aria-hidden className="absolute -right-[3px] top-[196px] h-[86px] w-1 rounded-r bg-[#3A3A3C]" />
        <div className="rounded-[56px] bg-[#1C1C1E] p-[11px] shadow-[inset_0_0_0_2px_#48484A,0_24px_48px_rgba(15,23,42,0.18)]">
          <div className="relative flex h-[640px] flex-col overflow-hidden rounded-[45px] bg-[#EFEAE2]">
            <div aria-hidden className="absolute left-1/2 top-[11px] z-10 h-8 w-[108px] -translate-x-1/2 rounded-[20px] bg-black" />

            <div aria-hidden className="flex h-[52px] flex-none items-center justify-between bg-[#F6F6F6] pl-[34px] pr-[30px] pt-1.5 text-black">
              <span className="text-[15px] font-semibold">9:41</span>
              <span className="flex items-center gap-[5px]">
                <svg width="17" height="11" viewBox="0 0 17 11" fill="#000"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" /><rect x="9" y="2.5" width="3" height="8.5" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
                <svg width="15" height="11" viewBox="0 0 15 11" fill="#000"><path d="M7.5 2.2c2.1 0 4 .8 5.5 2.2l1.1-1.1A9.3 9.3 0 0 0 7.5.6 9.3 9.3 0 0 0 .9 3.3L2 4.4a7.8 7.8 0 0 1 5.5-2.2zm0 3.2c1.2 0 2.4.5 3.2 1.3l1.1-1.1a6.1 6.1 0 0 0-8.6 0l1.1 1.1c.8-.8 2-1.3 3.2-1.3zm0 3.1c-.4 0-.8.2-1.1.5L7.5 10l1.1-1c-.3-.3-.7-.5-1.1-.5z" /></svg>
                <svg width="26" height="12" viewBox="0 0 26 12" fill="none"><rect x="0.5" y="0.5" width="22" height="11" rx="3.5" stroke="#000" opacity=".4" /><rect x="2" y="2" width="19" height="8" rx="2" fill="#000" /><path d="M24 4v4c.8-.3 1.3-1.1 1.3-2S24.8 4.3 24 4z" fill="#000" opacity=".5" /></svg>
              </span>
            </div>

            <div className="flex flex-none items-center gap-2 border-b border-[#DCDCE0] bg-[#F6F6F6] py-1 pb-2 pl-2 pr-3">
              <ChevronLeftIcon className="h-[22px] w-[22px] text-[#007AFF]" strokeWidth={2.4} />
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">
                {(companyName.trim()[0] ?? "U").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-black">{companyName}</span>
                <span className="block text-xs text-[#8E8E93]">online</span>
              </span>
              <VideoIcon className="h-6 w-6 text-[#007AFF]" strokeWidth={1.8} />
              <PhoneIcon className="ml-2.5 h-5 w-5 text-[#007AFF]" strokeWidth={1.8} />
            </div>

            <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-3">
              <div className="self-center rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-[#54656F] shadow-[0_1px_0_rgba(0,0,0,0.06)]">
                Hoje
              </div>
              {showStartMessage ? (
                <div className={bubble + " self-start rounded-tl-none bg-white"}>{startMessage.trim()}</div>
              ) : null}
              {trail.map((entry, i) => {
                const last = i === trail.length - 1;
                if (entry.from === "client") {
                  return (
                    <div key={i} className={bubble + " max-w-[80%] self-end rounded-tr-none bg-[#D9FDD3]"}>
                      {entry.text}
                    </div>
                  );
                }
                if (entry.from === "bot") {
                  return (
                    <div key={i} className={bubble + " self-start rounded-tl-none bg-white"}>
                      {entry.text}
                    </div>
                  );
                }
                if (entry.from === "system") {
                  return (
                    <div key={i} className="self-center rounded-lg bg-[#FFF5C4] px-2.5 py-1 text-center text-[11px] font-medium text-[#54656F]">
                      {entry.text}
                    </div>
                  );
                }
                const stage = state.stages.find((s) => s.id === entry.stageId);
                if (!stage) {
                  return (
                    <div key={i} className="self-center rounded-lg bg-[#FFF5C4] px-2.5 py-1 text-[11px] text-[#54656F]">
                      Etapa removida
                    </div>
                  );
                }
                if (stage.kind === "ai") {
                  return (
                    <div key={i} className="flex flex-col gap-2">
                      {stage.message.trim() ? (
                        <div className={bubble + " self-start rounded-tl-none bg-white"}>
                          {stage.message.trim()}
                        </div>
                      ) : null}
                      <div className="self-center rounded-lg bg-[#EDE7FE] px-2.5 py-1 text-center text-[11px] font-medium text-[#4C3A99]">
                        A IA conversa com o cliente a partir daqui
                      </div>
                    </div>
                  );
                }
                const opts = optionsOf(state, stage.id).slice(0, BOT_MENU_MAX_OPTIONS);
                return (
                  <div key={i} className="flex max-w-[88%] flex-col gap-1 self-start">
                    <div className={bubble + " max-w-full rounded-tl-none bg-white"}>
                      {stage.message.trim() || "(Mensagem ainda não escrita)"}
                    </div>
                    {opts.map((o, j) => (
                      <button
                        key={o.id}
                        type="button"
                        disabled={!last}
                        onClick={() => tap(o)}
                        className={[
                          "rounded-[10px] bg-white px-2.5 py-2 text-center text-[13px] font-semibold shadow-[0_1px_0_rgba(0,0,0,0.08)]",
                          last ? "text-[#0A7CFF] hover:bg-slate-50" : "cursor-default text-[#8696A0]",
                        ].join(" ")}
                      >
                        {j + 1}. {(o.label.trim() || "(sem texto)").slice(0, BOT_OPTION_LABEL_MAX_LENGTH)}
                      </button>
                    ))}
                    {opts.length === 0 ? (
                      <div className="py-0.5 text-center text-[11px] text-[#54656F]">
                        Sem botões: o bot encerra aqui
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div aria-hidden className="flex flex-none items-center gap-2.5 border-t border-[#DCDCE0] bg-[#F6F6F6] px-2.5 pb-1 pt-2">
              <PlusIcon className="h-6 w-6 text-[#007AFF]" />
              <span className="h-8 flex-1 rounded-2xl border border-[#DCDCE0] bg-white" />
              <CameraIcon className="h-[22px] w-[22px] text-[#007AFF]" strokeWidth={1.8} />
              <MicIcon className="h-[22px] w-[22px] text-[#007AFF]" strokeWidth={1.8} />
            </div>
            <div aria-hidden className="flex h-[26px] flex-none items-center justify-center bg-[#F6F6F6]">
              <span className="h-[5px] w-32 rounded-full bg-black" />
            </div>
          </div>
        </div>
      </div>
      <div className="text-xs leading-relaxed text-slate-500">
        No WhatsApp o cliente pode tocar no botão ou digitar o número.
      </div>
    </div>
  );
};
