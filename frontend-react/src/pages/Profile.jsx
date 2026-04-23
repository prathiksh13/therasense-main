import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useAuth } from '../context/AuthContext'
import { firestoreDb } from '../lib/firebase'
import Card from '../components/ui/Card'
import { OutlineButton, GreenButton } from '../components/ui/Buttons'
import SectionHeader from '../components/ui/SectionHeader'

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19c1.5-3 4-4.5 6-4.5s4.5 1.5 6 4.5" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.2 19.2 0 0 1-5.9-5.9A19.8 19.8 0 0 1 2.2 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8 9.9a16 16 0 0 0 6.1 6.1l1.5-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6-5.3-6-11a6 6 0 1 1 12 0c0 5.7-6 11-6 11Z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  )
}

export default function Profile() {
  const { loading: authLoading, user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [message, setMessage] = useState('')
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    phone: '',
    location: '',
    bio: '',
    role: '',
    createdAt: null,
  })

  useEffect(() => {
    async function loadProfile() {
      if (authLoading) return

      const uid = user?.uid
      if (!uid) {
        setLoading(false)
        return
      }

      try {
        const snapshot = await getDoc(doc(firestoreDb, 'users', uid))
        if (snapshot.exists()) {
          const data = snapshot.data()
          setProfile({
            name: data?.name || user?.displayName || '',
            email: data?.email || user?.email || '',
            phone: data?.phone || '',
            location: data?.location || '',
            bio: data?.bio || '',
            role: data?.role || '',
            createdAt: data?.createdAt || null,
          })
        }
      } catch (error) {
        console.error('Failed to load profile:', error)
      } finally {
        setLoading(false)
      }
    }

    loadProfile()
  }, [authLoading, user])

  function handleChange(event) {
    const { name, value } = event.target
    setProfile((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSave() {
    const uid = user?.uid
    if (!uid) return

    setSaving(true)
    setMessage('')
    try {
      await setDoc(
        doc(firestoreDb, 'users', uid),
        {
          name: profile.name || '',
          email: profile.email || user?.email || '',
          role: profile.role || '',
          phone: profile.phone || '',
          location: profile.location || '',
          bio: profile.bio || '',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
      setIsEditing(false)
      setMessage('Profile updated successfully.')
    } catch (error) {
      console.error('Failed to update profile:', error)
      setMessage('Could not save profile changes.')
    } finally {
      setSaving(false)
    }
  }

  const memberSince = useMemo(() => {
    if (profile.createdAt?.toDate) {
      return profile.createdAt.toDate().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    }
    return 'January 2024'
  }, [profile.createdAt])

  const avatarFallback = user?.displayName ? user.displayName.slice(0, 1).toUpperCase() : 'P'

  if (loading) {
    return <Card><p className="ts-text-secondary">Loading profile...</p></Card>
  }

  return (
    <section className="ts-page">
      <SectionHeader
        title="Profile"
        subtitle="Manage your personal information"
        actionLabel="Edit"
        onAction={() => setIsEditing((prev) => !prev)}
      />

      <Card>
        <div className="ts-profile-header">
          <div className="ts-profile-avatar">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={profile.name || user.displayName || 'Profile photo'}
                className="ts-profile-avatar__image"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span aria-hidden="true">{avatarFallback}</span>
            )}
          </div>
          <div>
            <h2 className="ts-section-title">{profile.name || 'patient'}</h2>
            <p className="ts-text-secondary">{profile.role || 'patient'} • Member since {memberSince}</p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="ts-profile-rows">
          <div className="ts-profile-row">
            <p className="ts-field-label">Full Name</p>
            {isEditing ? (
              <input name="name" value={profile.name} onChange={handleChange} className="ts-input" />
            ) : (
              <p>{profile.name || 'Not provided'}</p>
            )}
          </div>

          <div className="ts-profile-row">
            <p className="ts-field-label"><span className="ts-inline-icon"><MailIcon /></span>Email Address</p>
            <p>{profile.email || 'Not provided'}</p>
          </div>

          <div className="ts-profile-row">
            <p className="ts-field-label"><span className="ts-inline-icon"><PhoneIcon /></span>Phone Number</p>
            {isEditing ? (
              <input name="phone" value={profile.phone} onChange={handleChange} className="ts-input" />
            ) : (
              <p>{profile.phone || 'Not provided'}</p>
            )}
          </div>

          <div className="ts-profile-row">
            <p className="ts-field-label"><span className="ts-inline-icon"><PinIcon /></span>Location</p>
            {isEditing ? (
              <input name="location" value={profile.location} onChange={handleChange} className="ts-input" />
            ) : (
              <p>{profile.location || 'Not provided'}</p>
            )}
          </div>

          <div className="ts-profile-row">
            <p className="ts-field-label">Bio</p>
            {isEditing ? (
              <textarea name="bio" value={profile.bio} onChange={handleChange} className="ts-input ts-textarea" rows={3} />
            ) : (
              <p>{profile.bio || 'Not provided'}</p>
            )}
          </div>
        </div>
      </Card>

      {isEditing ? (
        <div className="ts-row-actions">
          <GreenButton onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</GreenButton>
          <OutlineButton onClick={() => setIsEditing(false)}>Cancel</OutlineButton>
        </div>
      ) : null}

      {message ? <p className="ts-text-secondary">{message}</p> : null}
    </section>
  )
}
