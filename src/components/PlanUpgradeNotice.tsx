import React from "react";
import { LockIcon } from "lucide-react";
import { useClinic } from "../contexts/ClinicContext";
import {
  FEATURE_IS_PLURAL,
  FEATURE_LABELS,
  type PlanFeature,
} from "../constants/plans";

// Tela no lugar de um recurso que o plano da empresa não inclui
export const PlanUpgradeNotice: React.FC<{ feature: PlanFeature }> = ({
  feature,
}) => {
  const { subscription } = useClinic();

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center bg-gray-50 p-6 text-center">
      <LockIcon className="mb-3 h-12 w-12 text-gray-300" />
      <h3 className="text-lg font-medium text-gray-900">
        {FEATURE_LABELS[feature]}{" "}
        {FEATURE_IS_PLURAL[feature] ? "não fazem" : "não faz"} parte do seu plano
      </h3>
      <p className="mt-1 max-w-md text-sm text-gray-500">
        {subscription ? `Sua empresa está no plano ${subscription.plan.name}. ` : ""}
        Este recurso está disponível nos planos Profissional e Empresarial.
        Fale com a Unxet para mudar de plano.
      </p>
    </div>
  );
};
