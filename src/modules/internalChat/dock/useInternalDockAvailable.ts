import { useMatch } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { useClinic } from "../../../contexts/ClinicContext";
import { useIsBelowLg } from "../../../hooks/useMediaQuery";

/** A janela aparece no computador e no tablet, fora da página do chat interno. */
export function useInternalDockAvailable() {
  const { authUser } = useAuth();
  const { clinicId, hasFeature } = useClinic();
  const isBelowLg = useIsBelowLg();
  const onChatPage = useMatch("/inbox/team/*") !== null;
  return (
    !isBelowLg &&
    !!authUser?.id &&
    !!clinicId &&
    hasFeature("internal_chat") &&
    !onChatPage
  );
}
