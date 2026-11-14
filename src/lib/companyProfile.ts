// Dados da empresa (Configurações > Dados da empresa): máscaras e validação
// do formulário. O banco (clinic_update_profile) valida de novo.

export type CompanyProfile = {
  name: string;
  legal_name: string;
  document: string;
  phone: string;
  email: string;
  website: string;
  postal_code: string;
  street: string;
  street_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type CompanyProfileErrors = Partial<Record<keyof CompanyProfile, string>>;

export const COMPANY_PROFILE_FIELDS: (keyof CompanyProfile)[] = [
  "name",
  "legal_name",
  "document",
  "phone",
  "email",
  "website",
  "postal_code",
  "street",
  "street_number",
  "complement",
  "neighborhood",
  "city",
  "state",
];

export const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** Linha do banco (colunas podem ser null) → valores do formulário, já com máscara. */
export const profileFromClinic = (
  clinic: Partial<Record<keyof CompanyProfile, string | null | undefined>> | null | undefined,
): CompanyProfile => {
  const value = (key: keyof CompanyProfile) => clinic?.[key]?.toString() ?? "";
  return {
    name: value("name"),
    legal_name: value("legal_name"),
    document: formatDocument(value("document")),
    phone: formatCompanyPhone(value("phone")),
    email: value("email"),
    website: value("website"),
    postal_code: formatPostalCode(value("postal_code")),
    street: value("street"),
    street_number: value("street_number"),
    complement: value("complement"),
    neighborhood: value("neighborhood"),
    city: value("city"),
    state: value("state"),
  };
};

/** Máscara de CPF (até 11 números) ou CNPJ (12 a 14) enquanto digita. */
export const formatDocument = (value: string) => {
  const d = digitsOf(value).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};

/** Telefone com DDD; aceita o 55 na frente (como o banco guarda). */
export const formatCompanyPhone = (value: string) => {
  let d = digitsOf(value);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = rest.length === 9 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
};

export const formatPostalCode = (value: string) => {
  const d = digitsOf(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

const cpfIsValid = (cpf: string) => {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]);
};

const cnpjIsValid = (cnpj: string) => {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const check = (length: number) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(cnpj[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(cnpj[12]) && check(13) === Number(cnpj[13]);
};

export const documentIsValid = (value: string) => {
  const d = digitsOf(value);
  return d.length === 11 ? cpfIsValid(d) : d.length === 14 ? cnpjIsValid(d) : false;
};

export const validateCompanyProfile = (profile: CompanyProfile): CompanyProfileErrors => {
  const errors: CompanyProfileErrors = {};
  const name = profile.name.trim();

  if (!name) errors.name = "Informe o nome da empresa.";
  else if (name.length > 120) errors.name = "Use no máximo 120 caracteres.";

  if (profile.legal_name.trim().length > 160) errors.legal_name = "Use no máximo 160 caracteres.";

  if (digitsOf(profile.document) && !documentIsValid(profile.document)) {
    errors.document = "CNPJ ou CPF inválido. Confira os números.";
  }

  const phone = digitsOf(profile.phone);
  if (phone && (phone.length < 10 || phone.length > 11)) {
    errors.phone = "Informe o telefone com DDD.";
  }

  const email = profile.email.trim();
  if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    errors.email = "E-mail inválido.";
  }

  const website = profile.website.trim();
  if (website) {
    const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    if (url.length > 200 || /\s/.test(url) || !/^https?:\/\/[^/]+\.[^/]+/i.test(url)) {
      errors.website = "Site inválido. Ex.: www.suaempresa.com.br";
    }
  }

  const postalCode = digitsOf(profile.postal_code);
  if (postalCode && postalCode.length !== 8) errors.postal_code = "O CEP tem 8 números.";

  if (profile.state && !BRAZIL_STATES.includes(profile.state)) errors.state = "Escolha a UF.";

  return errors;
};

/** Valores que vão para clinic_update_profile (o banco tira máscara e espaços). */
export const profilePayload = (profile: CompanyProfile) =>
  Object.fromEntries(
    COMPANY_PROFILE_FIELDS.map((key) => [key, profile[key].trim()]),
  ) as CompanyProfile;
