import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { Building2Icon, ChevronDownIcon } from "lucide-react";
import { useClinic } from "../contexts/ClinicContext";
import { supabase } from "../lib/supabaseClient";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card } from "../components/ui/Card";
import { SettingsTabs } from "../components/settings/SettingsTabs";
import PreTitleIcon from "../components/ui/PreTitleIcon";
import {
  BRAZIL_STATES,
  COMPANY_PROFILE_FIELDS,
  formatCompanyPhone,
  formatDocument,
  formatPostalCode,
  profileFromClinic,
  profilePayload,
  validateCompanyProfile,
  type CompanyProfile,
  type CompanyProfileErrors,
} from "../lib/companyProfile";

// Configurações > Dados da empresa. Só o admin chega aqui (rota AdminOnly) e o
// banco confere de novo em clinic_update_profile.
export const CompanyProfilePage: React.FC = () => {
  const { clinic, clinicId, refetch } = useClinic();
  const saved = useMemo(() => profileFromClinic(clinic), [clinic]);
  const [values, setValues] = useState<CompanyProfile>(saved);
  const [errors, setErrors] = useState<CompanyProfileErrors>({});
  const [saving, setSaving] = useState(false);

  // Quando a empresa termina de carregar (ou recarrega depois de salvar)
  useEffect(() => {
    setValues(saved);
  }, [saved]);

  const dirty = COMPANY_PROFILE_FIELDS.some((key) => values[key] !== saved[key]);

  const setField = (key: keyof CompanyProfile, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!clinicId || saving) return;

    const nextErrors = validateCompanyProfile(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error("Confira os campos destacados.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.rpc("clinic_update_profile", {
      p_clinic_id: clinicId,
      p_profile: profilePayload(values),
    });
    if (error) {
      setSaving(false);
      toast.error(error.message || "Não foi possível salvar os dados da empresa.");
      return;
    }
    await refetch();
    setSaving(false);
    toast.success("Dados da empresa salvos.");
  };

  const field = (
    key: keyof CompanyProfile,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> & {
      format?: (value: string) => string;
    } = {},
  ) => {
    const { format, ...inputProps } = props;
    return (
      <Input
        id={`company-${key}`}
        label={label}
        value={values[key]}
        onChange={(event) =>
          setField(key, format ? format(event.target.value) : event.target.value)
        }
        error={errors[key]}
        disabled={saving}
        {...inputProps}
      />
    );
  };

  const saveButton = (className: string) => (
    <Button
      type="submit"
      form="company-profile-form"
      variant="primary"
      isLoading={saving}
      disabled={!dirty || saving}
      className={className}
    >
      Salvar dados
    </Button>
  );

  return (
    <div className="flex h-full flex-1 flex-col bg-slate-50">
      <div className="border-b bg-white px-4 py-5 sm:px-8 sm:py-6">
        <div className="flex gap-3">
          <PreTitleIcon icon={Building2Icon} />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Dados da empresa
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Nome, documento, contato e endereço da sua empresa.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 sm:py-4">
          <SettingsTabs />
          {saveButton("hidden flex-shrink-0 sm:block")}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-5 sm:px-8 sm:py-6">
        <form
          id="company-profile-form"
          onSubmit={handleSubmit}
          noValidate
          className="mx-auto max-w-4xl space-y-5"
        >
          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Empresa</h2>
            <p className="mt-1 text-sm text-slate-500">
              O nome aparece no topo do app para toda a equipe.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {field("name", "Nome da empresa", {
                maxLength: 120,
                required: true,
                placeholder: "Como seus clientes conhecem a empresa",
              })}
              {field("legal_name", "Razão social (opcional)", { maxLength: 160 })}
              {field("document", "CNPJ ou CPF (opcional)", {
                inputMode: "numeric",
                format: formatDocument,
                placeholder: "00.000.000/0000-00",
              })}
            </div>
          </Card>

          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Contato</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {field("phone", "Telefone", {
                type: "tel",
                inputMode: "tel",
                format: formatCompanyPhone,
                placeholder: "(11) 98765-4321",
              })}
              {field("email", "E-mail", {
                type: "email",
                maxLength: 254,
                placeholder: "contato@suaempresa.com.br",
              })}
              {field("website", "Site", {
                type: "url",
                inputMode: "url",
                maxLength: 200,
                placeholder: "www.suaempresa.com.br",
              })}
            </div>
          </Card>

          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Endereço</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-6">
              <div className="sm:col-span-2">
                {field("postal_code", "CEP", {
                  inputMode: "numeric",
                  format: formatPostalCode,
                  placeholder: "00000-000",
                })}
              </div>
              <div className="sm:col-span-4">
                {field("street", "Rua", { maxLength: 120 })}
              </div>
              <div className="sm:col-span-2">
                {field("street_number", "Número", { maxLength: 20 })}
              </div>
              <div className="sm:col-span-4">
                {field("complement", "Complemento", {
                  maxLength: 120,
                  placeholder: "Sala, andar, bloco",
                })}
              </div>
              <div className="sm:col-span-2">
                {field("neighborhood", "Bairro", { maxLength: 120 })}
              </div>
              <div className="sm:col-span-3">
                {field("city", "Cidade", { maxLength: 120 })}
              </div>
              <div className="sm:col-span-1">
                <label
                  htmlFor="company-state"
                  className="mb-1 block text-sm font-medium text-gray-900"
                >
                  UF
                </label>
                <div className="relative">
                  <select
                    id="company-state"
                    value={values.state}
                    onChange={(event) => setField("state", event.target.value)}
                    disabled={saving}
                    className={`w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-8 text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#0A84FF] ${errors.state ? "border-red-500" : "border-gray-200"}`}
                  >
                    <option value="">--</option>
                    {BRAZIL_STATES.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                  <ChevronDownIcon className="pointer-events-none absolute right-2 top-3 h-4 w-4 text-gray-400" />
                </div>
                {errors.state && (
                  <p className="mt-1 text-sm text-red-500">{errors.state}</p>
                )}
              </div>
            </div>
          </Card>

          {/* No celular este é o único botão de salvar e fica fixo no rodapé */}
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end border-t bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-2">
            {saveButton("w-full sm:w-auto")}
          </div>
        </form>
      </div>
    </div>
  );
};
