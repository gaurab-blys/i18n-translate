import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpsertUser, useUser } from '../api/users'
import Spinner from '../components/Spinner.jsx'

export default function MainPage() {
  const { t } = useTranslation()
  const addressId = useId()
  const notesId = useId()
  const showOriginalStorageKey = 'blys:showOriginal'
  const [showOriginal, setShowOriginal] = useState(() => {
    try {
      return localStorage.getItem(showOriginalStorageKey) === 'true'
    } catch {
      return false
    }
  })

  const [addressDraft, setAddressDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [isAddressDirty, setIsAddressDirty] = useState(false)
  const [isNotesDirty, setIsNotesDirty] = useState(false)
  const upsertUser = useUpsertUser()

  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem('user') || ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    const onChanged = (e) => {
      const next = e?.detail?.userId
      if (typeof next === 'string') {
        setUserId(next)
        setAddressDraft('')
        setNotesDraft('')
        setIsAddressDirty(false)
        setIsNotesDirty(false)
      }
    }

    const onUpdated = (e) => {
      const nextUserId = e?.detail?.user?.userId
      if (typeof nextUserId === 'string' && nextUserId === userId) {
        // Prefer showing server-updated translations.
        setAddressDraft('')
        setNotesDraft('')
        setIsAddressDirty(false)
        setIsNotesDirty(false)
      }
    }

    window.addEventListener('blys:userChanged', onChanged)
    window.addEventListener('blys:userUpdated', onUpdated)
    return () => {
      window.removeEventListener('blys:userChanged', onChanged)
      window.removeEventListener('blys:userUpdated', onUpdated)
    }
  }, [userId])

  const userQuery = useUser(userId)

  const localized = userQuery.data?.localized?.translatedObject || null

  const addressValue = useMemo(() => {
    if (isAddressDirty) return addressDraft
    if (showOriginal) return userQuery.data?.address ?? ''
    return localized?.address ?? userQuery.data?.address ?? ''
  }, [addressDraft, isAddressDirty, localized?.address, showOriginal, userQuery.data?.address])

  const notesValue = useMemo(() => {
    if (isNotesDirty) return notesDraft
    if (showOriginal) return userQuery.data?.notes ?? ''
    return localized?.notes ?? userQuery.data?.notes ?? ''
  }, [isNotesDirty, notesDraft, localized?.notes, showOriginal, userQuery.data?.notes])

  const onSave = () => {
    if (!userId) return
    upsertUser.mutate({ userId, address: addressValue, notes: notesValue })
    setIsAddressDirty(false)
    setIsNotesDirty(false)
  }

  return (
    <main className="main">
      <div className="card">
        <h1 className="card__title">{t('form.title')}</h1>

        {userId && (userQuery.isLoading || userQuery.isFetching) ? (
          <div className="loading-screen" aria-busy="true">
            <Spinner size={28} label="Loading user" />
          </div>
        ) : null}

        {localized ? (
          <div className="field" style={{ marginBottom: 12 }}>
            <label className="field__label" htmlFor="showOriginalToggle">
              Translation
            </label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                id="showOriginalToggle"
                type="checkbox"
                checked={showOriginal}
                onChange={(e) => {
                  const next = e.target.checked
                  setShowOriginal(next)
                  try {
                    localStorage.setItem(showOriginalStorageKey, String(next))
                  } catch {
                    // ignore
                  }
                }}
              />
              <div style={{ fontSize: 14, opacity: 0.8 }}>
                {showOriginal ? 'Showing original' : 'Showing translated'}
              </div>
            </div>
          </div>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor={addressId}>
            {t('form.addressLabel')}
          </label>
          <input
            id={addressId}
            className="field__input"
            type="text"
            value={addressValue}
            onChange={(e) => {
              setIsAddressDirty(true)
              setAddressDraft(e.target.value)
            }}
            placeholder={t('form.addressPlaceholder')}
            autoComplete="street-address"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={notesId}>
            {t('form.notesLabel')}
          </label>
          <textarea
            id={notesId}
            className="field__textarea"
            value={notesValue}
            onChange={(e) => {
              setIsNotesDirty(true)
              setNotesDraft(e.target.value)
            }}
            placeholder={t('form.notesPlaceholder')}
            rows={5}
          />
        </div>

        <div className="actions">
          <button
            type="button"
            className="button"
            onClick={onSave}
            disabled={!userId || upsertUser.isPending}
          >
            <span className="button__content">
              {upsertUser.isPending ? <Spinner size={16} label="Saving" /> : null}
              <span>{upsertUser.isPending ? 'Saving…' : 'Save'}</span>
            </span>
          </button>
          {upsertUser.isError ? (
            <div className="actions__hint" role="alert">
              Failed to save.
            </div>
          ) : upsertUser.isSuccess ? (
            <div className="actions__hint">Saved.</div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
