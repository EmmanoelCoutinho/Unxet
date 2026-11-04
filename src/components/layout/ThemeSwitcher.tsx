import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useThemePreference, type ThemePreference } from "../../lib/theme";

const OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: typeof SunIcon;
}[] = [
  { value: "light", label: "Claro", Icon: SunIcon },
  { value: "dark", label: "Escuro", Icon: MoonIcon },
  { value: "system", label: "Automático", Icon: MonitorIcon },
];

/** Escolha do tema no menu do usuário. */
export const ThemeSwitcher = () => {
  const [pref, setPref] = useThemePreference();

  return (
    <div className="px-4 py-2">
      <div className="mb-1.5 text-xs font-medium text-gray-500">Tema</div>
      <div
        role="radiogroup"
        aria-label="Tema"
        className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1"
      >
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = pref === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPref(value)}
              title={
                value === "system"
                  ? "Segue o modo claro ou escuro do aparelho"
                  : undefined
              }
              className={`flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-[11px] font-medium transition ${
                active
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
