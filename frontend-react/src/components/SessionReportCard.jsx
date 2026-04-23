import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { usePageTransition } from '../context/PageTransitionContext'
import { cardBackgroundVariants, cardMotionVariants } from '../lib/pageTransitionMotion'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

function riskTone(risk = 'Low') {
  if (risk === 'High') return 'bg-red-500/20 text-red-100 border-red-400/30'
  if (risk === 'Medium') return 'bg-amber-500/20 text-amber-100 border-amber-400/30'
  return 'bg-emerald-500/20 text-emerald-100 border-emerald-400/30'
}

export default function SessionReportCard({ report, elementId = 'session-report-card' }) {
  const transition = usePageTransition()
  const createdAt = report?.createdAt?.toDate ? report.createdAt.toDate() : report?.createdAt instanceof Date ? report.createdAt : null
  const dateLabel = createdAt ? createdAt.toLocaleString() : 'Timestamp unavailable'
  const emotionData = report?.emotionData || {}
  const labels = emotionData?.labels || []
  const happy = emotionData?.happy || []
  const neutral = emotionData?.neutral || []
  const sad = emotionData?.sad || []
  const angry = emotionData?.angry || []
  const fearful = emotionData?.fearful || []
  const breakdown = emotionData?.breakdown || { happy: 0, neutral: 0, sad: 0, angry: 0, fearful: 0 }
  const aiSummary = emotionData?.aiSummary || report?.summary || 'No AI summary available.'
  const suggestions = emotionData?.suggestions || []
  const risk = emotionData?.riskIndicator || 'Low'
  const notes = emotionData?.sessionNotes || ''
  const prioritizedEmotion = emotionData?.prioritizedEmotion || 'neutral'

  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: 'Happy',
          data: happy,
          borderColor: '#34d399',
          backgroundColor: 'rgba(52,211,153,0.16)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Neutral',
          data: neutral,
          borderColor: '#9ca3af',
          backgroundColor: 'rgba(156,163,175,0.08)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Sad',
          data: sad,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.10)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Angry',
          data: angry,
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220,38,38,0.08)',
          tension: 0.35,
          fill: true,
        },
        {
          label: 'Fearful',
          data: fearful,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.08)',
          tension: 0.35,
          fill: true,
        },
      ],
    }),
    [angry, fearful, happy, labels, neutral, sad]
  )

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 1,
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: '#94a3b8' },
        },
        x: {
          grid: { color: 'rgba(255,255,255,0.08)' },
          ticks: { color: '#94a3b8', maxTicksLimit: 8 },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#cbd5e1' },
        },
      },
    }),
    []
  )

  const cardContent = (
    <>
      <header className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="dashboard-panel__eyebrow">TheraSense Session Report</p>
        <div className="mt-3 grid gap-2 text-sm text-slate-200 md:grid-cols-2">
          <p><span className="font-semibold text-slate-100">Patient:</span> {report?.patientName || 'Patient'}</p>
          <p><span className="font-semibold text-slate-100">Therapist:</span> {report?.therapistName || 'Therapist'}</p>
          <p><span className="font-semibold text-slate-100">Session Date & Time:</span> {dateLabel}</p>
          <p><span className="font-semibold text-slate-100">Session Duration:</span> {emotionData?.durationMinutes || '-'} min</p>
        </div>
      </header>

      <section className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="section-heading text-sm">Emotion Graph</h3>
        <p className="mt-2 text-xs text-slate-400">
          Prioritized clinical emotion: <span className="font-semibold uppercase text-rose-300">{prioritizedEmotion}</span>
        </p>
        <div className="mt-3 h-[260px] rounded-xl border border-white/10 bg-slate-900/30 p-3">
          <Line data={chartData} options={chartOptions} />
        </div>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="section-heading text-sm">Emotion Summary</h3>
          <p className="mt-2 text-sm text-slate-300">{report?.emotionSummary || 'No summary available'}</p>
          <div className="mt-3 space-y-1 text-xs text-slate-300">
            <p>Happy: {breakdown.happy}%</p>
            <p className="text-slate-400">Neutral (low priority): {breakdown.neutral}%</p>
            <p className="text-rose-300">Sad (critical): {breakdown.sad}%</p>
            <p className="text-rose-300">Angry (critical): {breakdown.angry}%</p>
            <p className="text-rose-300">Fearful (critical): {breakdown.fearful}%</p>
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="section-heading text-sm">AI Summary</h3>
          <p className="mt-2 text-sm text-slate-300">{aiSummary}</p>
        </article>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="section-heading text-sm">Suggestions</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {(suggestions.length ? suggestions : ['No suggestions available.']).map((item, index) => (
              <li key={`${item}-${index}`}>- {item}</li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="section-heading text-sm">Risk Indicator</h3>
          <p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${riskTone(risk)}`}>
            {risk}
          </p>
        </article>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="section-heading text-sm">Therapist Notes</h3>
        <p className="mt-2 text-sm text-slate-300 whitespace-pre-line">{notes || 'No notes recorded.'}</p>
      </section>
    </>
  )

  if (!transition) {
    return (
      <section id={elementId} className="report-panel glass rounded-2xl p-5 dashboard-card-hover">
        {cardContent}
      </section>
    )
  }

  return (
    <motion.section
      id={elementId}
      className="report-panel glass rounded-2xl p-5 dashboard-card-hover"
      variants={cardMotionVariants}
    >
      <motion.span className="ts-card-transition-bg" aria-hidden="true" variants={cardBackgroundVariants} />
      <div className="ts-card-transition-content">
        {cardContent}
      </div>
    </motion.section>
  )
}

