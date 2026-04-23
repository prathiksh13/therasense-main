import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import SearchBar from '../components/ui/SearchBar'
import SectionHeader from '../components/ui/SectionHeader'
import { useAuth } from '../context/AuthContext'
import { firestoreDb } from '../lib/firebase'
import { generateReportPdfFromData } from '../utils/generatePDF'
import { generateClinicalSessionReportPdf } from '../utils/generateClinicalSessionPdf'
import '../styles/journalReports.css'

const EMOTION_META = {
  happy: { label: 'Happy', color: '#22c55e', negative: false },
  neutral: { label: 'Neutral', color: '#64748b', negative: false },
  sad: { label: 'Sad', color: '#ef4444', negative: true },
  angry: { label: 'Angry', color: '#f97316', negative: true },
  fearful: { label: 'Fearful', color: '#7c3aed', negative: true },
}

const PATIENT_GRAPH_EMOTIONS = ['happy', 'neutral', 'sad']

function toDate(value) {
  if (value?.toDate) return value.toDate()
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDateLabel(value) {
  const date = toDate(value)
  return date ? date.toLocaleString() : 'Timestamp unavailable'
}

function safeNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseReportPayload(data = {}, fallbackId = '') {
  const createdAt = toDate(data?.createdAt)
  const createdLabel = createdAt ? createdAt.toLocaleString() : 'Timestamp unavailable'

  return {
    id: fallbackId,
    patientName: data?.patientName || 'Patient',
    therapistName: data?.therapistName || 'Therapist',
    summary: data?.summary || data?.emotionSummary || 'No summary available',
    createdAt,
    createdLabel,
    raw: data,
  }
}

function buildEmotionPoints(raw = {}) {
  const timeline = Array.isArray(raw?.timeline)
    ? raw.timeline
    : Array.isArray(raw?.emotionData?.timeline)
      ? raw.emotionData.timeline
      : []

  if (timeline.length) {
    return timeline.map((point, index) => {
      const expressions = point?.expressions || {}
      return {
        time: point?.time || `T${index + 1}`,
        happy: safeNumber(expressions.happy),
        neutral: safeNumber(expressions.neutral),
        sad: safeNumber(expressions.sad),
        angry: safeNumber(expressions.angry),
        fearful: safeNumber(expressions.fearful),
      }
    })
  }

  const graphData = raw?.graphData || raw?.emotionData || {}
  const labels = Array.isArray(graphData?.labels) ? graphData.labels : []
  if (!labels.length) return []

  return labels.map((label, index) => ({
    time: label,
    happy: safeNumber(graphData?.happy?.[index]),
    neutral: safeNumber(graphData?.neutral?.[index]),
    sad: safeNumber(graphData?.sad?.[index]),
    angry: safeNumber(graphData?.angry?.[index]),
    fearful: safeNumber(graphData?.fearful?.[index]),
  }))
}

function calculateEmotionPercentages(points = []) {
  if (!points.length) {
    return {
      happy: 0,
      neutral: 0,
      sad: 0,
      angry: 0,
      fearful: 0,
    }
  }

  const averages = Object.keys(EMOTION_META).reduce((accumulator, key) => {
    const average = points.reduce((sum, point) => sum + safeNumber(point[key]), 0) / points.length
    accumulator[key] = average
    return accumulator
  }, {})

  const total = Object.values(averages).reduce((sum, value) => sum + value, 0)
  if (!total) {
    return Object.keys(averages).reduce((accumulator, key) => {
      accumulator[key] = 0
      return accumulator
    }, {})
  }

  return Object.keys(averages).reduce((accumulator, key) => {
    accumulator[key] = Math.round((averages[key] / total) * 100)
    return accumulator
  }, {})
}

function getTopEmotions(percentages = {}, limit = 3) {
  return Object.keys(percentages)
    .map((emotion) => ({ emotion, percentage: safeNumber(percentages[emotion]) }))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, limit)
}

function getDominantEmotion(percentages = {}) {
  return getTopEmotions(percentages, 1)[0]?.emotion || 'neutral'
}

function buildPatientInsight(percentages = {}) {
  const stressLoad = safeNumber(percentages.sad) + safeNumber(percentages.angry) + safeNumber(percentages.fearful);
  
  if (stressLoad > 60) {
    return "You navigated some tough moments this session. Healing takes time, but you're doing the hard work by showing up.";
  } else if (stressLoad > 30) {
    return "You experienced a mix of feelings today. It's perfectly okay to have moments of stress alongside moments of calm.";
  } else {
    return "You maintained a strong sense of balance during this session. Keep using your coping strategies—they are working.";
  }
}

function getPositiveSummary(stressScore) {
  if (stressScore > 50) {
    return "You’re learning to sit with your emotions. That takes courage.";
  } else if (stressScore > 20) {
    return "You showed improved emotional balance during this session.";
  }
  return "You maintained a calm and grounded presence today.";
}

function buildJourneyPoints(points) {
  return points.map((p, i) => {
    const positive = safeNumber(p.happy) + safeNumber(p.neutral);
    const negative = safeNumber(p.sad) + safeNumber(p.angry) + safeNumber(p.fearful);
    const total = positive + negative || 1;
    const calmScore = Math.round((positive / total) * 100);
    
    return {
      time: p.time || `T${i}`,
      calmness: calmScore
    };
  });
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  )
}

export default function Reports() {
  const { role, uid, loading: authLoading } = useAuth()
  const isTherapist = role === 'therapist'

  const [search, setSearch] = useState('')
  const [reports, setReports] = useState([])
  const [loadingReports, setLoadingReports] = useState(false)
  const [openPatientReportId, setOpenPatientReportId] = useState('')
  const [activeTherapistReport, setActiveTherapistReport] = useState(null)
  const [selectedEmotions, setSelectedEmotions] = useState([])
  const [therapistNotes, setTherapistNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => {
    if (!uid || (role !== 'patient' && role !== 'therapist')) return undefined

    setLoadingReports(true)
    const reportsQuery = query(
      collection(firestoreDb, 'reports'),
      where(isTherapist ? 'therapistId' : 'patientId', '==', uid)
    )

    const unsubscribe = onSnapshot(
      reportsQuery,
      (snapshot) => {
        const mapped = snapshot.docs
          .map((entry) => parseReportPayload(entry.data(), entry.id))
          .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))

        setReports(mapped)
        setLoadingReports(false)
      },
      () => setLoadingReports(false)
    )

    return () => unsubscribe()
  }, [isTherapist, role, uid])

  const filteredReports = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return reports.filter((report) => {
      if (!needle) return true
      return (
        String(report.patientName).toLowerCase().includes(needle) ||
        String(report.summary).toLowerCase().includes(needle) ||
        String(report.therapistName).toLowerCase().includes(needle)
      )
    })
  }, [reports, search])

  async function handleSaveTherapistNotes() {
    if (!activeTherapistReport?.id) return

    try {
      setSavingNotes(true)
      await updateDoc(doc(firestoreDb, 'reports', activeTherapistReport.id), {
        therapistNotes,
        therapistNotesUpdatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.error('Failed to save therapist notes:', error)
    } finally {
      setSavingNotes(false)
    }
  }

  function openTherapistAnalysis(report) {
    setActiveTherapistReport(report)
    setSelectedEmotions([])
    setTherapistNotes(report?.raw?.therapistNotes || '')
  }

  function closeTherapistAnalysis() {
    setActiveTherapistReport(null)
    setSelectedEmotions([])
    setTherapistNotes('')
  }

  function toggleEmotion(emotion) {
    setSelectedEmotions((prev) => (prev.includes(emotion) ? prev.filter((item) => item !== emotion) : [...prev, emotion]))
  }

  function selectAllEmotions() {
    setSelectedEmotions(Object.keys(EMOTION_META))
  }

  function clearAllEmotions() {
    setSelectedEmotions([])
  }

  async function handleDownloadTherapistPdf(report, emotionsToInclude = selectedEmotions) {
    const points = buildEmotionPoints(report.raw)
    const percentages = calculateEmotionPercentages(points)
    const insights = buildTherapistInsights(points, percentages)
    const selected = (Array.isArray(emotionsToInclude) ? emotionsToInclude : []).filter(Boolean)

    if (!selected.length) {
      window.alert('Select at least one emotion before downloading the report.')
      return
    }

    await generateClinicalSessionReportPdf({
      report,
      points,
      selectedEmotions: selected,
      percentages,
      insights,
      therapistNotes,
      reportId: report.id,
      generatedAt: new Date().toLocaleString(),
      emotionMeta: EMOTION_META,
    })
  }

  const reportDetails = useMemo(() => {
    if (!activeTherapistReport) return null

    const points = buildEmotionPoints(activeTherapistReport.raw)
    const percentages = calculateEmotionPercentages(points)
    const dominantEmotion = getDominantEmotion(percentages)

    return {
      points,
      percentages,
      dominantEmotion,
      topThree: getTopEmotions(percentages, 3),
      insights: buildTherapistInsights(points, percentages),
    }
  }, [activeTherapistReport])

  if (authLoading) {
    return <Card><p className="ts-text-secondary">Loading reports...</p></Card>
  }

  return (
    <section className="ts-page ths-reports-page">
      <SectionHeader
        title={isTherapist ? 'Therapist Reports Dashboard' : 'Your Progress Summary'}
        subtitle={
          isTherapist
            ? 'Detailed session analysis for clinical review'
            : 'Encouraging insights to help you track your well-being'
        }
      />

      <SearchBar
        placeholder="Search reports..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {loadingReports ? <Card><p className="ts-text-secondary">Loading reports...</p></Card> : null}

      {!loadingReports && filteredReports.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No reports available"
          description="Session reports will appear here after your sessions"
        />
      ) : null}

      {!loadingReports && filteredReports.length > 0 ? (
        isTherapist ? (
          <div className="ths-therapist-report-table-wrap">
            <table className="ths-therapist-report-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Date</th>
                  <th>Duration</th>
                  <th>Dominant Emotion</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => {
                  const points = buildEmotionPoints(report.raw)
                  const percentages = calculateEmotionPercentages(points)
                  const dominantEmotion = getDominantEmotion(percentages)
                  return (
                    <tr key={report.id}>
                      <td>{report.patientName}</td>
                      <td>{report.createdLabel}</td>
                      <td>{report.raw?.emotionData?.durationMinutes || report.raw?.durationMinutes || 'N/A'} min</td>
                      <td>
                        <span className={`ths-emotion-badge ${EMOTION_META[dominantEmotion]?.negative ? 'is-negative' : ''}`}>
                          {EMOTION_META[dominantEmotion]?.label || dominantEmotion}
                        </span>
                      </td>
                      <td>
                        <div className="ths-report-actions">
                          <button type="button" className="ts-btn ts-btn--outline" onClick={() => openTherapistAnalysis(report)}>
                            Analyze Report
                          </button>
                          <button
                            type="button"
                            className="ts-btn ts-btn--primary"
                            onClick={() => {
                              const topSelected = getTopEmotions(percentages, 4).map((item) => item.emotion)
                              handleDownloadTherapistPdf(report, topSelected)
                            }}
                          >
                            Download
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ths-report-card-list">
            {filteredReports.map((report) => {
              const points = buildEmotionPoints(report.raw)
              const percentages = calculateEmotionPercentages(points)
              const stressScore = safeNumber(percentages.sad) + safeNumber(percentages.angry) + safeNumber(percentages.fearful)
              const calmScore = 100 - stressScore
              const journeyPoints = buildJourneyPoints(points)

              return (
                <Card key={report.id} className="ths-report-card ths-report-card--patient" style={{ borderTop: "4px solid #10b981", borderRadius: "16px" }}>
                  <div className="ths-report-card-head">
                    <div>
                      <h3 className="ts-section-title" style={{ fontSize: '1.15rem' }}>Session on {formatDateLabel(report.createdAt)}</h3>
                      <p className="ts-text-secondary">Therapist: {report.therapistName || 'Your Therapist'}</p>
                    </div>
                    <div className="ths-report-actions">
                      <button
                        type="button"
                        className="ts-btn ts-btn--outline"
                        onClick={() => setOpenPatientReportId((current) => (current === report.id ? '' : report.id))}
                      >
                        {openPatientReportId === report.id ? 'Close summary' : 'View progress'}
                      </button>
                    </div>
                  </div>

                  {openPatientReportId === report.id && (
                    <div className="patient-progress-panel" style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      
                      <div style={{ padding: '16px', background: 'linear-gradient(135deg, #f0fdf4, #e0f2fe)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ background: '#22c55e', color: '#fff', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                        </div>
                        <div>
                          <h4 style={{ margin: 0, color: '#166534', fontSize: '1rem', fontWeight: '600' }}>You're making progress</h4>
                          <p style={{ margin: '4px 0 0 0', color: '#15803d', fontSize: '0.9rem' }}>{getPositiveSummary(stressScore)}</p>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
                        <div style={{ padding: '20px 16px', background: '#f8fafc', borderRadius: '12px', textAlign: 'center' }}>
                          <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#475569', fontWeight: '500' }}>Emotional Stability Score</h4>
                          <div style={{ position: 'relative', width: '80px', height: '80px', margin: '0 auto' }}>
                            <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%' }}>
                              <path d="M18 2.08451 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                              <path d="M18 2.08451 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray={`${calmScore}, 100`} />
                            </svg>
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: '600', color: '#0f172a' }}>
                              {calmScore}
                            </div>
                          </div>
                          <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '12px', marginBottom: 0 }}>Balanced & Grounded</p>
                        </div>

                        <div style={{ padding: '20px 16px', background: '#f8fafc', borderRadius: '12px' }}>
                          <h4 style={{ margin: '0 0 14px 0', fontSize: '0.95rem', color: '#475569', fontWeight: '500' }}>Key Moments</h4>
                          <ul style={{ margin: 0, paddingLeft: '20px', color: '#334155', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <li>You showed growing self-awareness.</li>
                            <li>You reflected on difficult topics bravely.</li>
                            <li>You explored your feelings at a measured pace.</li>
                          </ul>
                        </div>
                      </div>

                      <div style={{ height: '220px', margin: '8px 0', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
                          <h4 style={{ margin: '0 0 16px 0', fontSize: '0.95rem', color: '#475569', fontWeight: '500' }}>Emotional Journey</h4>
                          <div style={{ width: '100%', height: 'calc(100% - 30px)' }}>
                            <EmotionalJourneyGraph points={journeyPoints} />
                          </div>
                      </div>

                      <div style={{ padding: '16px', background: '#f1f5f9', borderRadius: '12px', borderLeft: '4px solid #94a3b8' }}>
                        <p style={{ margin: 0, color: '#475569', fontSize: '0.95rem', fontStyle: 'italic', lineHeight: '1.5' }}>
                          "{buildPatientInsight(percentages)}"
                        </p>
                      </div>

                      <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '12px' }}>
                        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#92400e', fontWeight: '600' }}>What you can try this week</h4>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <span style={{ background: '#fde68a', color: '#b45309', padding: '6px 14px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '500' }}>Deep Breathing</span>
                          <span style={{ background: '#fde68a', color: '#b45309', padding: '6px 14px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '500' }}>Daily Journaling</span>
                          <span style={{ background: '#fde68a', color: '#b45309', padding: '6px 14px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: '500' }}>Positive Affirmations</span>
                        </div>
                      </div>

                      {report.raw?.therapistNotes ? (
                        <div style={{ padding: '16px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe' }}>
                          <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: '#1e3a8a', fontWeight: '600' }}>Message from your therapist</h4>
                          <p style={{ margin: 0, color: '#1e40af', fontSize: '0.95rem', lineHeight: '1.5' }}>{report.raw.therapistNotes}</p>
                        </div>
                      ) : null}

                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )
      ) : null}

      {isTherapist && activeTherapistReport && reportDetails ? (
        <div className="ths-modal-backdrop" role="dialog" aria-modal="true" aria-label="Analyze Report">
          <section className="ths-modal-card">
            <header className="ths-modal-header">
              <div>
                <p className="dashboard-panel__eyebrow">Analyze report</p>
                <h2 className="dashboard-panel__title">Clinical Session Analysis</h2>
              </div>
              <button type="button" className="ts-btn ts-btn--outline" onClick={closeTherapistAnalysis}>Close</button>
            </header>

            <div className="ths-modal-section-grid">
              <article className="ths-modal-section">
                <h3>Session details</h3>
                <p>Patient: {activeTherapistReport.patientName}</p>
                <p>Date: {activeTherapistReport.createdLabel}</p>
                <p>Duration: {activeTherapistReport.raw?.emotionData?.durationMinutes || activeTherapistReport.raw?.durationMinutes || 'N/A'} min</p>
                <p>Model: {activeTherapistReport.raw?.modelUsed || activeTherapistReport.raw?.emotionEngine || 'face-api.js'}</p>
              </article>

              <article className="ths-modal-section">
                <h3>Emotion percentages</h3>
                <div className="ths-report-top-emotions">
                  {reportDetails.topThree.map((item) => (
                    <div key={`${activeTherapistReport.id}-${item.emotion}`} className="ths-report-emotion-chip">
                      <span>{EMOTION_META[item.emotion]?.label || item.emotion}</span>
                      <strong>{item.percentage}%</strong>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <section className="ths-modal-section">
              <div className="ths-modal-section-head">
                <h3>Emotion selection</h3>
                <div className="ths-chip-actions">
                  <button type="button" className="ts-btn ts-btn--outline" onClick={selectAllEmotions}>Select All</button>
                  <button type="button" className="ts-btn ts-btn--outline" onClick={clearAllEmotions}>Clear All</button>
                </div>
              </div>
              <div className="ths-emotion-chip-row">
                {Object.keys(EMOTION_META).map((emotion) => (
                  <button
                    key={emotion}
                    type="button"
                    className={`ths-filter-chip ${selectedEmotions.includes(emotion) ? 'is-selected' : ''} ${EMOTION_META[emotion].negative ? 'is-negative' : ''}`}
                    onClick={() => toggleEmotion(emotion)}
                  >
                    {EMOTION_META[emotion].label}
                  </button>
                ))}
              </div>
            </section>

            <section className="ths-modal-section">
              <h3>Emotion graph</h3>
              <div className="ths-report-graph-shell ths-report-graph-shell--modal">
                {selectedEmotions.length ? (
                  <SimpleEmotionGraph points={reportDetails.points} selectedEmotions={selectedEmotions} />
                ) : (
                  <div className="ths-graph-empty">Select emotions to visualize</div>
                )}
              </div>
            </section>

            <section className="ths-modal-section">
              <h3>Analysis section</h3>
              <ul className="ths-analysis-list">
                <li>{reportDetails.insights.behavior}</li>
                <li>{reportDetails.insights.trend}</li>
                <li className={reportDetails.insights.risk.includes('High') ? 'is-risk' : ''}>{reportDetails.insights.risk}</li>
              </ul>
            </section>

            <section className="ths-modal-section">
              <h3>Therapist input</h3>
              <textarea
                rows={4}
                value={therapistNotes}
                onChange={(event) => setTherapistNotes(event.target.value)}
                className="ts-input ts-textarea"
                placeholder="Add clinical notes"
              />
            </section>

            <footer className="ths-modal-footer">
              <button
                type="button"
                className="ts-btn ts-btn--primary"
                onClick={() => handleDownloadTherapistPdf(activeTherapistReport, selectedEmotions)}
              >
                Download PDF (current filters)
              </button>
              <button type="button" className="ts-btn ts-btn--outline" disabled={savingNotes} onClick={handleSaveTherapistNotes}>
                {savingNotes ? 'Saving...' : 'Save notes'}
              </button>
              <button type="button" className="ts-btn ts-btn--outline" onClick={closeTherapistAnalysis}>Close</button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  )
}

function buildTherapistInsights(points = [], percentages = {}) {
  if (!points.length) {
    return {
      behavior: 'No behavior pattern detected yet.',
      trend: 'No emotion trend data available.',
      risk: 'Risk indicator: Low (insufficient data).',
    }
  }

  const first = points[0]
  const last = points[points.length - 1]
  const negativeLoad = points.reduce((sum, item) => sum + item.sad + item.angry + item.fearful, 0) / points.length
  const dominantEmotion = getDominantEmotion(percentages)

  const behavior = `Dominant emotion pattern: ${EMOTION_META[dominantEmotion]?.label || dominantEmotion}.`
  const trend = `Session shifted from neutral ${Math.round(first.neutral * 100)}% to ${Math.round(last.neutral * 100)}%, with negative-load average at ${Math.round(negativeLoad * 100)}%.`
  const risk = negativeLoad >= 0.5
    ? 'Risk indicator: High. Repeated negative emotional intensity detected.'
    : negativeLoad >= 0.28
      ? 'Risk indicator: Medium. Monitor stress-linked emotion clusters.'
      : 'Risk indicator: Low. Emotional regulation remained comparatively stable.'

  return { behavior, trend, risk }
}

function SimpleEmotionGraph({ points = [], selectedEmotions = [] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 10, right: 12, left: -12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(71,85,105,0.25)" />
        <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#475569' }} minTickGap={20} />
        <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: '#475569' }} width={30} />
        <Tooltip
          contentStyle={{
            borderRadius: 10,
            border: '1px solid rgba(148, 163, 184, 0.45)',
            background: 'rgba(255,255,255,0.96)',
          }}
        />
        {selectedEmotions.map((emotion) => (
          <Line
            key={emotion}
            type="monotone"
            dataKey={emotion}
            stroke={EMOTION_META[emotion]?.color || '#334155'}
            strokeWidth={2.4}
            dot={false}
            isAnimationActive
            animationDuration={440}
            animationEasing="ease-in-out"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function EmotionalJourneyGraph({ points = [] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" vertical={false} />
        <XAxis dataKey="time" hide />
        <YAxis domain={[0, 100]} hide />
        <Tooltip
          formatter={(value) => [`${value} / 100`, "Calmness Score"]}
          labelFormatter={() => "Moment"}
          contentStyle={{
            borderRadius: 8,
            border: 'none',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            background: 'rgba(255,255,255,0.95)',
            color: '#1e293b'
          }}
        />
        <Line
          type="monotone"
          dataKey="calmness"
          stroke="#10b981"
          strokeWidth={4}
          dot={false}
          activeDot={{ r: 6, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
          isAnimationActive
          animationDuration={800}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
