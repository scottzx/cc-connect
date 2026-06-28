import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import es from './locales/es.json';
import ko from './locales/ko.json';

const params = new URLSearchParams(window.location.search);
const queryLang = params.get('lang');
let saved = queryLang || localStorage.getItem('cc_lang') || navigator.language.split('-')[0] || 'en';
if (saved) {
  const savedLower = saved.toLowerCase();
  if (savedLower.startsWith('en')) {
    saved = 'en';
  } else if (savedLower.startsWith('zh-tw') || savedLower.startsWith('zh-hk')) {
    saved = 'zh-TW';
  } else if (savedLower.startsWith('zh')) {
    saved = 'zh';
  } else if (savedLower.startsWith('ja')) {
    saved = 'ja';
  } else if (savedLower.startsWith('es')) {
    saved = 'es';
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    'zh-TW': { translation: zhTW },
    ja: { translation: ja },
    es: { translation: es },
    ko: { translation: ko },
  },
  lng: saved,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Live language updates via iframe postMessage
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'LANG_CHANGE') {
    const newLang = e.data.lang;
    if (newLang) {
      let normalLang = 'zh';
      const langLower = newLang.toLowerCase();
      if (langLower.startsWith('en')) {
        normalLang = 'en';
      } else if (langLower.startsWith('zh-tw') || langLower.startsWith('zh-hk')) {
        normalLang = 'zh-TW';
      } else if (langLower.startsWith('ja')) {
        normalLang = 'ja';
      } else if (langLower.startsWith('es')) {
        normalLang = 'es';
      }
      i18n.changeLanguage(normalLang);
      localStorage.setItem('cc_lang', normalLang);
    }
  }
});

export default i18n;
