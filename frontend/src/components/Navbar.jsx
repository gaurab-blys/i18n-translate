import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguages } from '../api/languages'
import { useUpdateUserLanguage, useUser, useUsers } from '../api/users'

export default function Navbar() {
  const { t, i18n } = useTranslation()
  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem('user') || ''
    } catch {
      return ''
    }
  })

  const usersQuery = useUsers()
  const languagesQuery = useLanguages()
  const users = usersQuery.data ?? []
  const selectedUserId = userId || users[0]?.userId || ''

  const userQuery = useUser(selectedUserId)
  const updateLanguage = useUpdateUserLanguage()

  const languages = languagesQuery.data ?? []

  useEffect(() => {
    const preferred = userQuery.data?.language?.code
    if (preferred && preferred !== i18n.language) {
      i18n.changeLanguage(preferred)
    }
  }, [i18n, userQuery.data?.language?.code])

  const onUserChange = (nextUserId) => {
    setUserId(nextUserId)
    try {
      localStorage.setItem('user', nextUserId)
    } catch {
      // ignore
    }

    window.dispatchEvent(new CustomEvent('blys:userChanged', { detail: { userId: nextUserId } }))
  }

  const languageValue = useMemo(() => {
    return userQuery.data?.language?.code || i18n.language
  }, [i18n.language, userQuery.data?.language?.code])

  const onLanguageChange = (nextLanguageCode) => {
    i18n.changeLanguage(nextLanguageCode)
    if (!selectedUserId) return
    updateLanguage.mutate(
      { userId: selectedUserId, languageCode: nextLanguageCode },
      {
        onSuccess: (updatedUser) => {
          window.dispatchEvent(new CustomEvent('blys:userUpdated', { detail: { user: updatedUser } }))
        },
      },
    )
  }

  return (
    <header className="nav">
      <div className="nav__inner">
        <div className="nav__brand">Blys</div>

        <div className="nav__right">
          <div className="nav__controls">
            <label className="nav__label" htmlFor="language">
              {t('language')}
            </label>
            <select
              id="language"
              className="nav__select"
              value={languageValue}
              onChange={(e) => onLanguageChange(e.target.value)}
              disabled={languagesQuery.isLoading || !userId}
            >
              {languages.map((lang) => {
                const code = lang.code
                return (
                  <option key={code} value={code}>
                    {t(`languages.${code}`)}
                  </option>
                )
              })}
            </select>
          </div>

          <div className="nav__controls">
            <label className="nav__label" htmlFor="user">
              {t('user')}
            </label>
            <select
              id="user"
              className="nav__select"
              value={selectedUserId}
              onChange={(e) => onUserChange(e.target.value)}
              disabled={usersQuery.isLoading}
            >
              {users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.userId}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </header>
  )
}
