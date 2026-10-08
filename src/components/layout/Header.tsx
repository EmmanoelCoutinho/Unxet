import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MenuIcon } from "lucide-react";
import logo from "../../assets/logo-unxet.png";
import { useAuth } from "../../contexts/AuthContext";
import { useClinic } from "../../contexts/ClinicContext";
import { ProfileModal } from "./ProfileModal";
import { MobileNav } from "./MobileNav";

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export const Header = () => {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { clinic } = useClinic();

  const initials = useMemo(
    () => getInitials(profile?.name || ""),
    [profile?.name],
  );

  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const isAdmin = profile?.role === "admin";

  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleSingOut = async () => {
    await signOut();
    setOpen(false);
    navigate("/login");
  };

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!open) return;
      const target = e.target as Node | null;
      if (
        target &&
        (menuRef.current?.contains(target) ||
          buttonRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <header className="w-full border-b border-[#E5E7EB] bg-white fixed top-0 h-16 z-30">
      <div className="mx-auto max-w-7xl px-3 sm:px-4 h-full flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="-ml-1 rounded-lg p-2 text-gray-700 hover:bg-gray-100 md:hidden"
            aria-label="Abrir menu"
            aria-expanded={mobileNavOpen}
          >
            <MenuIcon className="h-6 w-6" />
          </button>
          <Link to="/inbox" className="flex items-center gap-2 select-none">
            <img src={logo} alt="Unxet logo" className="w-28 sm:w-36" />
          </Link>
        </div>
        <div className="relative flex min-w-0 items-center justify-end gap-3 sm:gap-4">
          <button
            ref={buttonRef}
            onClick={() => setOpen((v) => !v)}
            className="w-9 h-9 flex-shrink-0 rounded-full bg-[#0A84FF] text-white flex items-center justify-center font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0A84FF]"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Abrir menu do usuário"
          >
            {initials}
          </button>
          {open && (
            <div
              ref={menuRef}
              role="menu"
              className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[#E5E7EB] bg-white shadow-lg z-50 overflow-hidden"
            >
              <div className="px-4 py-3 bg-[#F9FAFB]">
                <div className="text-[#1E1E1E] font-medium truncate">
                  {profile?.name}
                </div>
                {clinic?.name && (
                  <div className="truncate text-xs text-gray-500 sm:hidden">
                    {clinic.name}
                  </div>
                )}
                {profile?.role && (
                  <div className="text-sm text-gray-600">
                    {profile?.role === "admin" ? "Administrador" : "Usuário"}
                  </div>
                )}
              </div>
              <div className="py-1">
                <button
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F3F4F6]"
                  onClick={() => {
                    setOpen(false);
                    setProfileOpen(true);
                  }}
                >
                  Meu perfil
                </button>
                {isAdmin && (
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F3F4F6]"
                    onClick={() => {
                      setOpen(false);
                      navigate("/inbox/settings");
                    }}
                  >
                    Configurações
                  </button>
                )}
                <div className="my-1 h-px bg-[#E5E7EB]" />
                <button
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                  onClick={handleSingOut}
                >
                  Sair
                </button>
              </div>
            </div>
          )}
          <span className="hidden min-w-0 max-w-[16rem] truncate sm:block lg:max-w-xs">
            {clinic?.name}
          </span>
        </div>
      </div>
      <MobileNav
        open={mobileNavOpen}
        onClose={closeMobileNav}
        clinicName={clinic?.name}
      />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  );
};
