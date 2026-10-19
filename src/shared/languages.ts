export const languages = [
  { code: "auto", label: "Detectar automáticamente" },
  { code: "es", label: "Español" },
  { code: "en", label: "Inglés" },
  { code: "fr", label: "Francés" },
  { code: "de", label: "Alemán" },
  { code: "pt", label: "Portugués" },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];
export type TargetLanguageCode = Exclude<LanguageCode, "auto">;

export const languageName = (code: LanguageCode) =>
  languages.find((language) => language.code === code)?.label ?? code;
