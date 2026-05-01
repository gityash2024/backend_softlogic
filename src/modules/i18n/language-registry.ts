export interface SupportedPortalLanguage {
  id: string;
  googleCode: string;
  englishName: string;
  nativeName: string;
  regionCode: string;
}

export const supportedPortalLanguages: SupportedPortalLanguage[] = [
  { id: 'en-us', googleCode: 'en', englishName: 'English (US)', nativeName: 'English (US)', regionCode: 'US' },
  { id: 'es-es', googleCode: 'es', englishName: 'Spanish', nativeName: 'Espanol', regionCode: 'ES' },
  { id: 'fr-fr', googleCode: 'fr', englishName: 'French', nativeName: 'Francais', regionCode: 'FR' },
  { id: 'de-de', googleCode: 'de', englishName: 'German', nativeName: 'Deutsch', regionCode: 'DE' },
  { id: 'ja-jp', googleCode: 'ja', englishName: 'Japanese', nativeName: 'Nihongo', regionCode: 'JP' },
  { id: 'hi-in', googleCode: 'hi', englishName: 'Hindi', nativeName: 'Hindi', regionCode: 'IN' },
  { id: 'pt-pt', googleCode: 'pt', englishName: 'Portuguese', nativeName: 'Portugues', regionCode: 'PT' },
  { id: 'ko-kr', googleCode: 'ko', englishName: 'Korean', nativeName: 'Hangugo', regionCode: 'KR' },
  { id: 'en-gb', googleCode: 'en', englishName: 'English (UK)', nativeName: 'English (UK)', regionCode: 'GB' },
  { id: 'zh-cn', googleCode: 'zh-CN', englishName: 'Chinese (Simplified)', nativeName: 'Chinese Simplified', regionCode: 'CN' },
  { id: 'zh-tw', googleCode: 'zh-TW', englishName: 'Chinese (Traditional)', nativeName: 'Chinese Traditional', regionCode: 'TW' },
  { id: 'ar-sa', googleCode: 'ar', englishName: 'Arabic', nativeName: 'Arabic', regionCode: 'SA' },
  { id: 'ru-ru', googleCode: 'ru', englishName: 'Russian', nativeName: 'Russkiy', regionCode: 'RU' },
  { id: 'it-it', googleCode: 'it', englishName: 'Italian', nativeName: 'Italiano', regionCode: 'IT' },
  { id: 'nl-nl', googleCode: 'nl', englishName: 'Dutch', nativeName: 'Nederlands', regionCode: 'NL' },
  { id: 'sv-se', googleCode: 'sv', englishName: 'Swedish', nativeName: 'Svenska', regionCode: 'SE' },
  { id: 'no-no', googleCode: 'no', englishName: 'Norwegian', nativeName: 'Norsk', regionCode: 'NO' },
  { id: 'da-dk', googleCode: 'da', englishName: 'Danish', nativeName: 'Dansk', regionCode: 'DK' },
  { id: 'fi-fi', googleCode: 'fi', englishName: 'Finnish', nativeName: 'Suomi', regionCode: 'FI' },
  { id: 'pl-pl', googleCode: 'pl', englishName: 'Polish', nativeName: 'Polski', regionCode: 'PL' },
  { id: 'tr-tr', googleCode: 'tr', englishName: 'Turkish', nativeName: 'Turkce', regionCode: 'TR' },
  { id: 'el-gr', googleCode: 'el', englishName: 'Greek', nativeName: 'Greek', regionCode: 'GR' },
  { id: 'he-il', googleCode: 'he', englishName: 'Hebrew', nativeName: 'Hebrew', regionCode: 'IL' },
  { id: 'id-id', googleCode: 'id', englishName: 'Indonesian', nativeName: 'Bahasa Indonesia', regionCode: 'ID' },
  { id: 'ms-my', googleCode: 'ms', englishName: 'Malay', nativeName: 'Bahasa Melayu', regionCode: 'MY' },
  { id: 'th-th', googleCode: 'th', englishName: 'Thai', nativeName: 'Thai', regionCode: 'TH' },
  { id: 'vi-vn', googleCode: 'vi', englishName: 'Vietnamese', nativeName: 'Tieng Viet', regionCode: 'VN' },
  { id: 'uk-ua', googleCode: 'uk', englishName: 'Ukrainian', nativeName: 'Ukrainian', regionCode: 'UA' },
  { id: 'cs-cz', googleCode: 'cs', englishName: 'Czech', nativeName: 'Cestina', regionCode: 'CZ' },
  { id: 'sk-sk', googleCode: 'sk', englishName: 'Slovak', nativeName: 'Slovencina', regionCode: 'SK' },
  { id: 'hu-hu', googleCode: 'hu', englishName: 'Hungarian', nativeName: 'Magyar', regionCode: 'HU' },
  { id: 'ro-ro', googleCode: 'ro', englishName: 'Romanian', nativeName: 'Romana', regionCode: 'RO' },
  { id: 'bg-bg', googleCode: 'bg', englishName: 'Bulgarian', nativeName: 'Bulgarian', regionCode: 'BG' },
  { id: 'hr-hr', googleCode: 'hr', englishName: 'Croatian', nativeName: 'Hrvatski', regionCode: 'HR' },
  { id: 'sr-rs', googleCode: 'sr', englishName: 'Serbian', nativeName: 'Srpski', regionCode: 'RS' },
  { id: 'sl-si', googleCode: 'sl', englishName: 'Slovenian', nativeName: 'Slovenscina', regionCode: 'SI' },
  { id: 'lt-lt', googleCode: 'lt', englishName: 'Lithuanian', nativeName: 'Lietuviu', regionCode: 'LT' },
  { id: 'lv-lv', googleCode: 'lv', englishName: 'Latvian', nativeName: 'Latviesu', regionCode: 'LV' },
  { id: 'et-ee', googleCode: 'et', englishName: 'Estonian', nativeName: 'Eesti', regionCode: 'EE' },
  { id: 'fa-ir', googleCode: 'fa', englishName: 'Persian', nativeName: 'Farsi', regionCode: 'IR' },
  { id: 'ur-pk', googleCode: 'ur', englishName: 'Urdu', nativeName: 'Urdu', regionCode: 'PK' },
  { id: 'bn-bd', googleCode: 'bn', englishName: 'Bengali', nativeName: 'Bangla', regionCode: 'BD' },
  { id: 'ta-in', googleCode: 'ta', englishName: 'Tamil', nativeName: 'Tamil', regionCode: 'IN' },
  { id: 'te-in', googleCode: 'te', englishName: 'Telugu', nativeName: 'Telugu', regionCode: 'IN' },
  { id: 'mr-in', googleCode: 'mr', englishName: 'Marathi', nativeName: 'Marathi', regionCode: 'IN' },
  { id: 'gu-in', googleCode: 'gu', englishName: 'Gujarati', nativeName: 'Gujarati', regionCode: 'IN' },
  { id: 'kn-in', googleCode: 'kn', englishName: 'Kannada', nativeName: 'Kannada', regionCode: 'IN' },
  { id: 'ml-in', googleCode: 'ml', englishName: 'Malayalam', nativeName: 'Malayalam', regionCode: 'IN' },
  { id: 'pa-in', googleCode: 'pa', englishName: 'Punjabi', nativeName: 'Punjabi', regionCode: 'IN' },
  { id: 'sw-ke', googleCode: 'sw', englishName: 'Swahili', nativeName: 'Kiswahili', regionCode: 'KE' },
  { id: 'af-za', googleCode: 'af', englishName: 'Afrikaans', nativeName: 'Afrikaans', regionCode: 'ZA' },
  { id: 'sq-al', googleCode: 'sq', englishName: 'Albanian', nativeName: 'Shqip', regionCode: 'AL' },
  { id: 'ca-es', googleCode: 'ca', englishName: 'Catalan', nativeName: 'Catala', regionCode: 'ES' },
  { id: 'eu-es', googleCode: 'eu', englishName: 'Basque', nativeName: 'Euskara', regionCode: 'ES' },
  { id: 'gl-es', googleCode: 'gl', englishName: 'Galician', nativeName: 'Galego', regionCode: 'ES' },
  { id: 'is-is', googleCode: 'is', englishName: 'Icelandic', nativeName: 'Islenska', regionCode: 'IS' },
  { id: 'ga-ie', googleCode: 'ga', englishName: 'Irish', nativeName: 'Gaeilge', regionCode: 'IE' },
  { id: 'cy-gb', googleCode: 'cy', englishName: 'Welsh', nativeName: 'Cymraeg', regionCode: 'GB' },
  { id: 'mt-mt', googleCode: 'mt', englishName: 'Maltese', nativeName: 'Malti', regionCode: 'MT' },
  { id: 'fil-ph', googleCode: 'fil', englishName: 'Filipino', nativeName: 'Filipino', regionCode: 'PH' },
  { id: 'am-et', googleCode: 'am', englishName: 'Amharic', nativeName: 'Amharic', regionCode: 'ET' },
  { id: 'hy-am', googleCode: 'hy', englishName: 'Armenian', nativeName: 'Hayeren', regionCode: 'AM' },
  { id: 'ka-ge', googleCode: 'ka', englishName: 'Georgian', nativeName: 'Kartuli', regionCode: 'GE' },
  { id: 'kk-kz', googleCode: 'kk', englishName: 'Kazakh', nativeName: 'Kazakh', regionCode: 'KZ' },
  { id: 'mn-mn', googleCode: 'mn', englishName: 'Mongolian', nativeName: 'Mongolian', regionCode: 'MN' },
  { id: 'ne-np', googleCode: 'ne', englishName: 'Nepali', nativeName: 'Nepali', regionCode: 'NP' },
  { id: 'si-lk', googleCode: 'si', englishName: 'Sinhala', nativeName: 'Sinhala', regionCode: 'LK' },
];

const languageById = new Map(
  supportedPortalLanguages.map((language) => [language.id, language]),
);

const languageByGoogleCode = new Map<string, SupportedPortalLanguage>();
supportedPortalLanguages.forEach((language) => {
  const key = language.googleCode.toLowerCase();
  if (!languageByGoogleCode.has(key)) {
    languageByGoogleCode.set(key, language);
  }
});

export const normalizeLanguageId = (language: string | undefined): string => {
  const normalized = (language || 'en-us').trim().replace(/_/g, '-').toLowerCase();
  if (languageById.has(normalized)) {
    return normalized;
  }

  const googleMatch = languageByGoogleCode.get(normalized);
  if (googleMatch) {
    return googleMatch.id;
  }

  const languageOnly = normalized.split('-')[0];
  return languageByGoogleCode.get(languageOnly)?.id ?? 'en-us';
};

export const getSupportedLanguage = (language: string): SupportedPortalLanguage => {
  return languageById.get(normalizeLanguageId(language)) ?? supportedPortalLanguages[0];
};
