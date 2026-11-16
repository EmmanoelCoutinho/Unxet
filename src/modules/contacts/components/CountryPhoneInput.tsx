import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { FIELD_CLASS } from "../../leads/components/LeadModal";
import { findPhoneCountry, searchPhoneCountries } from "../utils/countryPhone";

const PANEL_HEIGHT = 300;

/** Bandeira em SVG (public/flags): emoji de bandeira não aparece no Windows. */
const Flag: React.FC<{ iso: string }> = ({ iso }) => (
  <img
    src={`/flags/${iso}.svg`}
    alt=""
    width={20}
    height={14}
    loading="lazy"
    className="h-3.5 w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-black/10"
  />
);

/**
 * Campo de telefone com o país na frente (Brasil por padrão). O país abre
 * uma lista com busca; o número é digitado sem o código do país.
 */
export const CountryPhoneInput: React.FC<{
  id: string;
  country: string;
  onCountryChange: (iso: string) => void;
  value: string;
  onChange: (value: string) => void;
  /** Classe do campo do número (cada tela tem o seu estilo de campo). */
  fieldClassName?: string;
  className?: string;
}> = ({ id, country, onCountryChange, value, onChange, fieldClassName = FIELD_CLASS, className = "mt-1" }) => {
  const selected = findPhoneCountry(country);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const results = useMemo(() => searchPhoneCountries(query), [query]);

  // A janela do cadastro rola: a lista fica por cima dela, presa ao campo
  const place = () => {
    const r = triggerRef.current?.closest("[data-phone-field]")?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom;
    const top = below >= PANEL_HEIGHT + 12 || below > r.top ? r.bottom + 4 : r.top - PANEL_HEIGHT - 4;
    setPos({ top: Math.max(8, top), left, width });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const choose = (iso: string) => {
    onCountryChange(iso);
    close();
    inputRef.current?.focus();
  };

  const onSearchKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      // Só fecha a lista, não a janela do cadastro
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      close();
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      // Enter escolhe o país, não envia o formulário
      event.preventDefault();
      if (results[active]) choose(results[active].iso);
    }
  };

  return (
    <div data-phone-field className={`${className} flex gap-2`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`País: ${selected.name} (+${selected.dial}). Trocar país`}
        title={selected.name}
        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      >
        <Flag iso={selected.iso} />
        <span>+{selected.dial}</span>
        <ChevronDownIcon className="h-4 w-4 text-slate-400" />
      </button>
      <input
        ref={inputRef}
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={selected.iso === "BR" ? "(11) 98765-4321" : "Número"}
        className={`${fieldClassName} min-w-0 flex-1`}
      />

      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              style={{ top: pos.top, left: pos.left, width: pos.width, height: PANEL_HEIGHT }}
              className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
                <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Buscar país ou código"
                  aria-label="Buscar país"
                  aria-controls={`${id}-countries`}
                  className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>
              {results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">Nenhum país encontrado.</p>
              ) : (
                <ul
                  ref={listRef}
                  id={`${id}-countries`}
                  role="listbox"
                  aria-label="Países"
                  className="flex-1 overflow-y-auto overscroll-contain p-1"
                >
                  {results.map((c, index) => (
                    <li
                      key={c.iso}
                      role="option"
                      aria-selected={c.iso === selected.iso}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(c.iso)}
                      className={[
                        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
                        index === active ? "bg-slate-100" : "",
                        c.iso === selected.iso ? "font-semibold text-blue-600" : "text-slate-700",
                      ].join(" ")}
                    >
                      <Flag iso={c.iso} />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 text-slate-500">+{c.dial}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
