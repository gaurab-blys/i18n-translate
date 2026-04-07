import i18n from 'i18next'
import { initReactI18next } from '../node_modules/react-i18next'

const resources = {
  en: {
    translation: {
      language: 'Language',
      user: 'User',
      languages: {
        en: 'English',
        fr: 'French',
        gr: 'Greek',
      },
      users: {
        user1: 'User 1',
        user2: 'User 2',
        user3: 'User 3',
      },
      form: {
        title: 'Main page',
        addressLabel: 'Address',
        addressPlaceholder: 'Enter your address',
        notesLabel: 'Notes',
        notesPlaceholder: 'Add notes',
      },
    },
  },
  fr: {
    translation: {
      language: 'Langue',
      user: 'Utilisateur',
      languages: {
        en: 'Anglais',
        fr: 'Français',
        gr: 'Grec',
      },
      users: {
        user1: 'Utilisateur 1',
        user2: 'Utilisateur 2',
        user3: 'Utilisateur 3',
      },
      form: {
        title: 'Page principale',
        addressLabel: 'Adresse',
        addressPlaceholder: 'Entrez votre adresse',
        notesLabel: 'Notes',
        notesPlaceholder: 'Ajoutez des notes',
      },
    },
  },
  gr: {
    translation: {
      language: 'Γλώσσα',
      user: 'Χρήστης',
      languages: {
        en: 'Αγγλικά',
        fr: 'Γαλλικά',
        gr: 'Ελληνικά',
      },
      users: {
        user1: 'Χρήστης 1',
        user2: 'Χρήστης 2',
        user3: 'Χρήστης 3',
      },
      form: {
        title: 'Κύρια σελίδα',
        addressLabel: 'Διεύθυνση',
        addressPlaceholder: 'Εισάγετε τη διεύθυνσή σας',
        notesLabel: 'Σημειώσεις',
        notesPlaceholder: 'Προσθέστε σημειώσεις',
      },
    },
  },
}

const storedLng = typeof window !== 'undefined' ? localStorage.getItem('lng') : null

i18n.use(initReactI18next).init({
  resources,
  lng: storedLng || 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'fr', 'gr'],
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('lng', lng)
  } catch {
    // ignore
  }
})

export default i18n
