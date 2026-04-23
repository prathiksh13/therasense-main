import { useMemo, useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { firestoreDb } from '../lib/firebase'

export default function TherapistNotes({ therapistId, sessions = [] }) {
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  const sessionOptions = useMemo(
    () => sessions.map((item) => ({ value: item.id, label: `${item.title} • ${item.subtitle}` })),
    [sessions]
  )

  async function handleSaveNote() {
    const trimmedNote = noteText.trim()
    if (!selectedSessionId || !trimmedNote || !therapistId) {
      setStatus('Select a session and write notes before saving.')
      return
    }

    setSaving(true)
    setStatus('')
    try {
      await addDoc(collection(firestoreDb, 'therapistNotes'), {
        therapistId,
        sessionId: selectedSessionId,
        note: trimmedNote,
        savedAt: serverTimestamp(),
      })

      fetch('/send-therapist-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          therapistId,
          therapistMessage: trimmedNote,
        }),
      }).catch((error) => {
        console.error('Failed to send therapist follow-up email:', error)
      })

      setNoteText('')
      setStatus('Session notes saved.')
    } catch (error) {
      console.error('Failed to save therapist notes:', error)
      setStatus('Could not save notes. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="workspace-panel glass p-4 dashboard-card-hover">
      <p className="dashboard-panel__eyebrow">Therapist Notes</p>
      <h2 className="section-heading">Capture during-session or post-session observations.</h2>

      <div className="mt-4 grid gap-3">
        <label className="text-sm text-slate-300">
          Session
          <select
            value={selectedSessionId}
            onChange={(event) => setSelectedSessionId(event.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
          >
            <option value="" className="bg-slate-900">Select a session</option>
            {sessionOptions.map((option) => (
              <option key={option.value} value={option.value} className="bg-slate-900">
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-300">
          Notes
          <textarea
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
            rows={4}
            placeholder="Write therapeutic observations, interventions, and follow-up plan"
          />
        </label>

        <button
          type="button"
          onClick={handleSaveNote}
          disabled={saving}
          className="workspace-button workspace-button--primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-70"
        >
          {saving ? 'Saving...' : 'Save Notes'}
        </button>
      </div>

      {status ? <p className="mt-3 text-xs text-cyan-200">{status}</p> : null}
    </section>
  )
}
