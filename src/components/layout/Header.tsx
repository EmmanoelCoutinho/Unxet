import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import logo from "../../assets/logo-unxet.png";
import { useAuth } from "../../contexts/AuthContext";
import { useClinic } from "../../contexts/ClinicContext";
import { ProfileModal } from "./ProfileModal";

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
    <header className="w-full border-b border-[#E5E7EB] bg-white fixed top-0 h-16 z-10">
      <div className="mx-auto max-w-7xl px-4 h-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/inbox" className="flex items-center gap-2 select-none">
            <img src={logo} alt="Unxet logo" className="w-36" />
          </Link>
        </div>
        <div className="relative flex items-center justify-center gap-4">
          <button
            ref={buttonRef}
            onClick={() => setOpen((v) => !v)}
            className="w-9 h-9 rounded-full bg-[#0A84FF] text-white flex items-center justify-center font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0A84FF]"
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
              className="absolute right-10 top-full mt-2 w-64 rounded-lg border border-[#E5E7EB] bg-white shadow-lg z-50 overflow-hidden"
            >
              <div className="px-4 py-3 bg-[#F9FAFB]">
                <div className="text-[#1E1E1E] font-medium">
                  {profile?.name}
                </div>
                {profile?.role && (
                  <div className="text-sm text-gray-600">
                    {profile?.role === "admin" ? "Administrador" : "Usuário"}
                  </div>
                )}
              </div>
              <div className="py-1">
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-[#F3F4F6]"
                  onClick={() => {
                    setOpen(false);
                    setProfileOpen(true);
                  }}
                >
                  Meu perfil
                </button>
                {isAdmin && (
                  <button
                    className="w-full text-left px-4 py-2 text-sm hover:bg-[#F3F4F6]"
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
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  onClick={handleSingOut}
                >
                  Sair
                </button>
              </div>
            </div>
          )}
          <span>{clinic?.name}</span>
        </div>
      </div>
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  );
};
