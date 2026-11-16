import { normalizeTypedPhone, onlyDigits } from "../../scheduledMessages/utils/schedule";

export type PhoneCountry = { iso: string; name: string; dial: string };

/**
 * Código de discagem por país (ISO 3166). Os países do Caribe que usam o +1
 * já vêm com o código de área, então basta digitar o número local.
 */
const DIAL_CODES: Record<string, string> = {
  AF: "93", AL: "355", DZ: "213", AS: "1684", AD: "376", AO: "244", AI: "1264",
  AG: "1268", AR: "54", AM: "374", AW: "297", AU: "61", AT: "43", AZ: "994",
  BS: "1242", BH: "973", BD: "880", BB: "1246", BY: "375", BE: "32", BZ: "501",
  BJ: "229", BM: "1441", BT: "975", BO: "591", BA: "387", BW: "267", BR: "55",
  BN: "673", BG: "359", BF: "226", BI: "257", CV: "238", KH: "855", CM: "237",
  CA: "1", KY: "1345", CF: "236", TD: "235", CL: "56", CN: "86", CO: "57",
  KM: "269", CG: "242", CD: "243", CK: "682", CR: "506", CI: "225", HR: "385",
  CU: "53", CW: "599", CY: "357", CZ: "420", DK: "45", DJ: "253", DM: "1767",
  DO: "1809", EC: "593", EG: "20", SV: "503", GQ: "240", ER: "291", EE: "372",
  SZ: "268", ET: "251", FK: "500", FO: "298", FJ: "679", FI: "358", FR: "33",
  GF: "594", PF: "689", GA: "241", GM: "220", GE: "995", DE: "49", GH: "233",
  GI: "350", GR: "30", GL: "299", GD: "1473", GP: "590", GU: "1671", GT: "502",
  GN: "224", GW: "245", GY: "592", HT: "509", HN: "504", HK: "852", HU: "36",
  IS: "354", IN: "91", ID: "62", IR: "98", IQ: "964", IE: "353", IL: "972",
  IT: "39", JM: "1876", JP: "81", JO: "962", KZ: "7", KE: "254", KI: "686",
  KP: "850", KR: "82", XK: "383", KW: "965", KG: "996", LA: "856", LV: "371",
  LB: "961", LS: "266", LR: "231", LY: "218", LI: "423", LT: "370", LU: "352",
  MO: "853", MG: "261", MW: "265", MY: "60", MV: "960", ML: "223", MT: "356",
  MH: "692", MQ: "596", MR: "222", MU: "230", YT: "262", MX: "52", FM: "691",
  MD: "373", MC: "377", MN: "976", ME: "382", MS: "1664", MA: "212", MZ: "258",
  MM: "95", NA: "264", NR: "674", NP: "977", NL: "31", NC: "687", NZ: "64",
  NI: "505", NE: "227", NG: "234", MK: "389", NO: "47", OM: "968", PK: "92",
  PW: "680", PS: "970", PA: "507", PG: "675", PY: "595", PE: "51", PH: "63",
  PL: "48", PT: "351", PR: "1787", QA: "974", RE: "262", RO: "40", RU: "7",
  RW: "250", KN: "1869", LC: "1758", VC: "1784", WS: "685", SM: "378",
  ST: "239", SA: "966", SN: "221", RS: "381", SC: "248", SL: "232", SG: "65",
  SX: "1721", SK: "421", SI: "386", SB: "677", SO: "252", ZA: "27", SS: "211",
  ES: "34", LK: "94", SD: "249", SR: "597", SE: "46", CH: "41", SY: "963",
  TW: "886", TJ: "992", TZ: "255", TH: "66", TL: "670", TG: "228", TO: "676",
  TT: "1868", TN: "216", TR: "90", TM: "993", TC: "1649", TV: "688", UG: "256",
  UA: "380", AE: "971", GB: "44", US: "1", UY: "598", UZ: "998", VU: "678",
  VA: "39", VE: "58", VN: "84", VG: "1284", VI: "1340", YE: "967", ZM: "260",
  ZW: "263",
};

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["pt-BR"], { type: "region" });
  } catch {
    return null;
  }
})();

const countryName = (iso: string) => {
  try {
    return regionNames?.of(iso) ?? iso;
  } catch {
    return iso;
  }
};

export const DEFAULT_COUNTRY = "BR";

/** Brasil primeiro; o resto em ordem alfabética. */
export const PHONE_COUNTRIES: PhoneCountry[] = (() => {
  const all = Object.entries(DIAL_CODES).map(([iso, dial]) => ({
    iso,
    dial,
    name: countryName(iso),
  }));
  const brazil = all.filter((c) => c.iso === DEFAULT_COUNTRY);
  const rest = all
    .filter((c) => c.iso !== DEFAULT_COUNTRY)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return [...brazil, ...rest];
})();

export const findPhoneCountry = (iso: string) =>
  PHONE_COUNTRIES.find((c) => c.iso === iso) ?? PHONE_COUNTRIES[0];

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** Busca por nome (sem acento), sigla ou código ("fran", "FR", "+33"). */
export const searchPhoneCountries = (query: string): PhoneCountry[] => {
  const q = fold(query.trim());
  if (!q) return PHONE_COUNTRIES;
  const digits = onlyDigits(q);
  const byDial = /^\+?\d+$/.test(q);
  return PHONE_COUNTRIES.filter((c) =>
    byDial
      ? c.dial.startsWith(digits)
      : fold(c.name).includes(q) || c.iso.toLowerCase() === q,
  );
};

/**
 * Número digitado + país escolhido -> dígitos com o código do país.
 *  - Brasil: mesma regra de sempre (DDD + número).
 *  - Outro país: o número local, sem o 0 da frente (ex.: França 07 45 51 36
 *    37 -> 33745513637). Quem digitar com + já manda o número completo.
 */
export const buildCountryPhone = (input: string, iso: string): string | null => {
  const raw = String(input ?? "").trim();
  if (iso === DEFAULT_COUNTRY || raw.startsWith("+")) return normalizeTypedPhone(raw);
  const local = onlyDigits(raw).replace(/^0+/, "");
  if (local.length < 4) return null;
  const full = `${findPhoneCountry(iso).dial}${local}`;
  return full.length >= 8 && full.length <= 15 ? full : null;
};
