import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import SectionHeader from '../components/ui/SectionHeader'
import { useAuth } from '../context/AuthContext'
import { firestoreDb } from '../lib/firebase'

const MIN_AI_COUNT = 5
const MAX_AI_COUNT = 10

const DEFAULT_EXPLANATION =
  'This response supports emotional acknowledgment and a calm, practical coping step.'

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5.5h6M9.5 3h5a1 1 0 0 1 1 1v1.5h-7V4a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

function normalizeQuestionShape(question, index) {
  const options = Array.isArray(question?.options) ? question.options : []
  const cleanOptions = options
    .map((option) => String(option || '').trim())
    .filter(Boolean)

  return {
    id: `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    questionText: String(question?.questionText || '').trim(),
    options: [
      cleanOptions[0] || '',
      cleanOptions[1] || '',
      cleanOptions[2] || '',
      cleanOptions[3] || '',
    ],
    correctAnswer: String(question?.correctAnswer || '').trim(),
    explanation: String(question?.explanation || '').trim(),
  }
}

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase()
}

function getScoreLabel(scaledScore) {
  if (scaledScore <= 4) return 'Needs more support'
  if (scaledScore <= 7) return 'Growing awareness'
  return 'Strong emotional awareness'
}

function calculateReflectionScore(questions = [], answerItems = []) {
  const answerMap = new Map(answerItems.map((item) => [Number(item.questionIndex), String(item.selectedOption || '')]))
  const scorable = questions.filter((question) => String(question?.correctAnswer || '').trim())

  if (!questions.length) {
    return { raw: 0, outOf: 0, scaledOutOf10: 0, label: getScoreLabel(0) }
  }

  if (!scorable.length) {
    const raw = Math.min(questions.length, answerItems.length)
    const scaledOutOf10 = Math.round((raw / questions.length) * 10)
    return {
      raw,
      outOf: questions.length,
      scaledOutOf10,
      label: getScoreLabel(scaledOutOf10),
    }
  }

  const raw = questions.reduce((count, question, index) => {
    const recommended = normalizeText(question.correctAnswer)
    if (!recommended) return count
    const selected = normalizeText(answerMap.get(index))
    return selected && selected === recommended ? count + 1 : count
  }, 0)

  const scaledOutOf10 = Math.round((raw / scorable.length) * 10)
  return {
    raw,
    outOf: scorable.length,
    scaledOutOf10,
    label: getScoreLabel(scaledOutOf10),
  }
}

function formatDuration(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Not recorded'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (!mins) return `${secs}s`
  return `${mins}m ${secs}s`
}

function getAnswerRatioByPattern(answers = [], pattern) {
  if (!answers.length) return 0
  const matchCount = answers.filter((answer) => pattern.test(String(answer || ''))).length
  return matchCount / answers.length
}

function buildInsightSummary(assignment, response) {
  if (Array.isArray(response?.insights) && response.insights.length) {
    return response.insights
  }

  if (!response) {
    return ['Awaiting patient attempt.']
  }

  const selectedOptions = (response.answers || [])
    .map((item) => item?.selectedOption)
    .filter(Boolean)

  if (!selectedOptions.length) {
    return ['Response submitted with no selected options recorded.']
  }

  const neutralRatio = getAnswerRatioByPattern(selectedOptions, /\b(neutral|balanced|sometimes|occasionally)\b/i)
  const avoidanceRatio = getAnswerRatioByPattern(selectedOptions, /\b(not sure|unsure|skip|avoid|none|prefer not)\b/i)

  const insights = []
  if (avoidanceRatio >= 0.34) {
    insights.push('Patient shows avoidance patterns')
  }
  if (neutralRatio >= 0.4) {
    insights.push('Prefers neutral responses')
  }

  if (!insights.length) {
    insights.push('Responses indicate active engagement with assignment prompts.')
  }

  if ((response.answers || []).length < (assignment.questions || []).length) {
    insights.push('Some questions were left unanswered; consider gentle follow-up.')
  }

  return insights
}

function buildEncouragingInsights(assignment, answers = []) {
  const selectedOptions = answers
    .map((item) => item?.selectedOption)
    .filter(Boolean)

  if (!selectedOptions.length) {
    return ['You completed this reflection, and that is a meaningful first step.']
  }

  const neutralRatio = getAnswerRatioByPattern(selectedOptions, /\b(neutral|balanced|sometimes|occasionally)\b/i)
  const avoidanceRatio = getAnswerRatioByPattern(selectedOptions, /\b(not sure|unsure|skip|avoid|none|prefer not)\b/i)
  const groundingRatio = getAnswerRatioByPattern(selectedOptions, /\b(breathe|pause|ground|share|reflect|calm)\b/i)

  const insights = []
  if (avoidanceRatio >= 0.34) {
    insights.push('You tend to choose avoidance-based responses')
  }
  if (groundingRatio >= 0.34) {
    insights.push('You show good emotional awareness in stressful situations')
  }
  if (neutralRatio >= 0.4) {
    insights.push('You often choose neutral responses, which can be a stabilizing step')
  }
  if ((answers || []).length < (assignment.questions || []).length) {
    insights.push('You may benefit from pausing briefly with each question before choosing a response')
  }

  if (!insights.length) {
    insights.push('You are building awareness step by step through your responses')
  }

  return insights
}

export default function Assignments() {
  const { role, uid } = useAuth()
  const isTherapist = role === 'therapist'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generatingAi, setGeneratingAi] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [patientOptions, setPatientOptions] = useState([])
  const [assignments, setAssignments] = useState([])
  const [responsesByAssignmentId, setResponsesByAssignmentId] = useState({})

  const [title, setTitle] = useState('')
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [questions, setQuestions] = useState([
    { id: `q_${Date.now()}`, questionText: '', options: ['', '', '', ''], correctAnswer: '' },
  ])
  const [aiQuestionCount, setAiQuestionCount] = useState(5)

  const [activeAssignmentId, setActiveAssignmentId] = useState('')
  const [selectedAnswers, setSelectedAnswers] = useState({})
  const [submittingResponse, setSubmittingResponse] = useState(false)
  const [attemptStartedAtByAssignmentId, setAttemptStartedAtByAssignmentId] = useState({})

  const activeAssignment = useMemo(
    () => assignments.find((assignment) => assignment.id === activeAssignmentId) || null,
    [activeAssignmentId, assignments]
  )

  const pendingAssignments = useMemo(
    () => assignments.filter((item) => String(item.status || 'assigned') !== 'completed'),
    [assignments]
  )

  const completedAssignments = useMemo(
    () => assignments.filter((item) => String(item.status || 'assigned') === 'completed'),
    [assignments]
  )

  const activeResponse = useMemo(() => {
    if (!activeAssignmentId) return null
    return responsesByAssignmentId[activeAssignmentId] || null
  }, [activeAssignmentId, responsesByAssignmentId])

  const activeScore = useMemo(() => {
    if (!activeAssignment || !activeResponse) return null
    const stored = activeResponse.score
    if (stored && Number.isFinite(Number(stored.scaledOutOf10))) {
      return {
        raw: Number(stored.raw || 0),
        outOf: Number(stored.outOf || 0),
        scaledOutOf10: Number(stored.scaledOutOf10 || 0),
        label: String(stored.label || getScoreLabel(Number(stored.scaledOutOf10 || 0))),
      }
    }
    return calculateReflectionScore(activeAssignment.questions, activeResponse.answers)
  }, [activeAssignment, activeResponse])

  const resetComposer = useCallback(() => {
    setTitle('')
    setSelectedPatientId('')
    setQuestions([{ id: `q_${Date.now()}`, questionText: '', options: ['', '', '', ''], correctAnswer: '', explanation: '' }])
  }, [])

  const loadAssignments = useCallback(async () => {
    if (!uid || !role) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      if (isTherapist) {
        const [assignmentSnapshot, therapistPatientSnapshot] = await Promise.all([
          getDocs(query(collection(firestoreDb, 'assignments'), where('therapistId', '==', uid))),
          getDocs(query(collection(firestoreDb, 'therapistPatients'), where('therapistId', '==', uid))),
        ])

        const patientIds = Array.from(
          new Set(
            therapistPatientSnapshot.docs
              .map((entry) => entry.data()?.patientId)
              .filter(Boolean)
          )
        )

        const userSnapshots = await Promise.all(patientIds.map((patientId) => getDoc(doc(firestoreDb, 'users', patientId))))
        const mappedPatients = userSnapshots
          .filter((entry) => entry.exists())
          .map((entry) => {
            const data = entry.data()
            return {
              id: entry.id,
              name: data?.name || data?.email || entry.id,
              email: data?.email || '',
            }
          })
          .sort((a, b) => a.name.localeCompare(b.name))

        setPatientOptions(mappedPatients)

        const mappedAssignments = assignmentSnapshot.docs
          .map((entry) => {
            const data = entry.data()
            return {
              id: entry.id,
              therapistId: data?.therapistId || '',
              patientId: data?.patientId || '',
              title: data?.title || 'Untitled assignment',
              questions: Array.isArray(data?.questions) ? data.questions : [],
              status: data?.status || 'assigned',
              createdAt: data?.createdAt?.toDate ? data.createdAt.toDate() : null,
            }
          })
          .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))

        setAssignments(mappedAssignments)

        const responseEntries = await Promise.all(
          mappedAssignments.map(async (assignment) => {
            const responseSnapshot = await getDocs(
              query(collection(firestoreDb, 'responses'), where('assignmentId', '==', assignment.id), limit(1))
            )
            if (responseSnapshot.empty) return [assignment.id, null]

            const first = responseSnapshot.docs[0]
            const data = first.data()
            return [
              assignment.id,
              {
                id: first.id,
                patientId: data?.patientId || '',
                answers: Array.isArray(data?.answers) ? data.answers : [],
                completedAt: data?.completedAt?.toDate ? data.completedAt.toDate() : null,
                score: data?.score || null,
                insights: Array.isArray(data?.insights) ? data.insights : [],
                timeTakenSeconds: Number(data?.timeTakenSeconds || 0),
              },
            ]
          })
        )

        setResponsesByAssignmentId(Object.fromEntries(responseEntries))
        return
      }

      const assignmentSnapshot = await getDocs(
        query(collection(firestoreDb, 'assignments'), where('patientId', '==', uid))
      )
      const responseSnapshot = await getDocs(query(collection(firestoreDb, 'responses'), where('patientId', '==', uid)))

      const mappedAssignments = assignmentSnapshot.docs
        .map((entry) => {
          const data = entry.data()
          return {
            id: entry.id,
            therapistId: data?.therapistId || '',
            patientId: data?.patientId || '',
            title: data?.title || 'Untitled assignment',
            questions: Array.isArray(data?.questions) ? data.questions : [],
            status: data?.status || 'assigned',
            createdAt: data?.createdAt?.toDate ? data.createdAt.toDate() : null,
          }
        })
        .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))

      setAssignments(mappedAssignments)

      const mappedResponses = responseSnapshot.docs.map((entry) => {
        const data = entry.data()
        return {
          assignmentId: data?.assignmentId || '',
          payload: {
            id: entry.id,
            patientId: data?.patientId || '',
            answers: Array.isArray(data?.answers) ? data.answers : [],
            completedAt: data?.completedAt?.toDate ? data.completedAt.toDate() : null,
            score: data?.score || null,
            insights: Array.isArray(data?.insights) ? data.insights : [],
            timeTakenSeconds: Number(data?.timeTakenSeconds || 0),
          },
        }
      })
      setResponsesByAssignmentId(
        Object.fromEntries(mappedResponses.filter((item) => item.assignmentId).map((item) => [item.assignmentId, item.payload]))
      )

      if (mappedAssignments.length && !activeAssignmentId) {
        const firstPending = mappedAssignments.find((assignment) => String(assignment.status || 'assigned') !== 'completed')
        setActiveAssignmentId((firstPending || mappedAssignments[0]).id)
      }
    } catch (loadError) {
      console.error('Failed to load assignments:', loadError)
      setError('Unable to load assignments right now. Please retry.')
    } finally {
      setLoading(false)
    }
  }, [activeAssignmentId, isTherapist, role, uid])

  useEffect(() => {
    loadAssignments()
  }, [loadAssignments])

  useEffect(() => {
    if (isTherapist || !activeAssignmentId) return

    const response = responsesByAssignmentId[activeAssignmentId]
    if (response?.answers?.length) {
      const mapped = {}
      response.answers.forEach((answer) => {
        mapped[answer.questionIndex] = answer.selectedOption
      })
      setSelectedAnswers(mapped)
      return
    }

    setSelectedAnswers({})
  }, [activeAssignmentId, isTherapist, responsesByAssignmentId])

  useEffect(() => {
    if (isTherapist || !activeAssignmentId || responsesByAssignmentId[activeAssignmentId]) return
    setAttemptStartedAtByAssignmentId((prev) => {
      if (prev[activeAssignmentId]) return prev
      return { ...prev, [activeAssignmentId]: Date.now() }
    })
  }, [activeAssignmentId, isTherapist, responsesByAssignmentId])

  function updateQuestionText(questionId, value) {
    setQuestions((prev) => prev.map((item) => (item.id === questionId ? { ...item, questionText: value } : item)))
  }

  function updateQuestionOption(questionId, optionIndex, value) {
    setQuestions((prev) =>
      prev.map((item) => {
        if (item.id !== questionId) return item
        const nextOptions = [...item.options]
        nextOptions[optionIndex] = value
        return { ...item, options: nextOptions }
      })
    )
  }

  function updateQuestionCorrectAnswer(questionId, value) {
    setQuestions((prev) => prev.map((item) => (item.id === questionId ? { ...item, correctAnswer: value } : item)))
  }

  function updateQuestionExplanation(questionId, value) {
    setQuestions((prev) => prev.map((item) => (item.id === questionId ? { ...item, explanation: value } : item)))
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, { id: `q_${Date.now()}_${prev.length}`, questionText: '', options: ['', '', '', ''], correctAnswer: '', explanation: '' }])
  }

  function removeQuestion(questionId) {
    setQuestions((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((item) => item.id !== questionId)
    })
  }

  async function handleGenerateWithAi() {
    setError('')
    setSuccess('')

    const safeCount = Math.max(MIN_AI_COUNT, Math.min(MAX_AI_COUNT, Number(aiQuestionCount) || MIN_AI_COUNT))
    setAiQuestionCount(safeCount)
    setGeneratingAi(true)

    try {
      const response = await fetch('/api/assignments/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: safeCount }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || 'AI generation request failed')
      }

      const generated = Array.isArray(payload?.questions)
        ? payload.questions.map((question, index) => normalizeQuestionShape(question, index))
        : []

      if (!generated.length) {
        throw new Error('AI generation returned no valid questions')
      }

      setQuestions(generated)
      if (!title.trim()) {
        setTitle('AI Reflection Assignment')
      }
      setSuccess(`Generated ${generated.length} questions with AI.`)
    } catch (aiError) {
      console.error('Failed to generate assignment questions:', aiError)
      setError(aiError.message || 'Unable to generate questions with AI at the moment.')
    } finally {
      setGeneratingAi(false)
    }
  }

  async function handleCreateAssignment() {
    if (!uid) return

    setError('')
    setSuccess('')

    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Please add an assignment title.')
      return
    }

    if (!selectedPatientId) {
      setError('Please select a patient before sending the assignment.')
      return
    }

    const normalizedQuestions = questions
      .map((question) => ({
        questionText: String(question.questionText || '').trim(),
        options: (question.options || []).map((option) => String(option || '').trim()).filter(Boolean),
        correctAnswer: String(question.correctAnswer || '').trim(),
        explanation: String(question.explanation || '').trim() || DEFAULT_EXPLANATION,
      }))
      .filter((question) => question.questionText && question.options.length >= 4)

    if (!normalizedQuestions.length) {
      setError('Add at least one valid MCQ with options before sending.')
      return
    }

    setSaving(true)

    try {
      await addDoc(collection(firestoreDb, 'assignments'), {
        therapistId: uid,
        patientId: selectedPatientId,
        title: cleanTitle,
        questions: normalizedQuestions,
        createdAt: serverTimestamp(),
        status: 'assigned',
      })

      setSuccess('Assignment sent to patient successfully.')
      resetComposer()
      await loadAssignments()
    } catch (createError) {
      console.error('Failed to create assignment:', createError)
      setError('Unable to send assignment. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleSelectAnswer(questionIndex, value) {
    setSelectedAnswers((prev) => ({ ...prev, [questionIndex]: value }))
  }

  async function handleSubmitResponse() {
    if (!uid || !activeAssignment) return

    setError('')
    setSuccess('')

    const answers = activeAssignment.questions
      .map((question, questionIndex) => ({
        questionIndex,
        selectedOption: selectedAnswers[questionIndex] || '',
      }))
      .filter((item) => item.selectedOption)

    if (!answers.length) {
      setError('Please answer at least one question before submitting.')
      return
    }

    setSubmittingResponse(true)

    try {
      const responseId = `${activeAssignment.id}_${uid}`
      const score = calculateReflectionScore(activeAssignment.questions, answers)
      const completedAtMs = Date.now()
      const startedAtMs = attemptStartedAtByAssignmentId[activeAssignment.id] || completedAtMs
      const timeTakenSeconds = Math.max(0, Math.round((completedAtMs - startedAtMs) / 1000))
      const insights = buildEncouragingInsights(activeAssignment, answers)

      await setDoc(doc(firestoreDb, 'responses', responseId), {
        assignmentId: activeAssignment.id,
        patientId: uid,
        answers,
        score,
        insights,
        timeTakenSeconds,
        completedAt: serverTimestamp(),
      })

      await updateDoc(doc(firestoreDb, 'assignments', activeAssignment.id), {
        status: 'completed',
      })

      setSuccess('Your responses have been recorded.')
      await loadAssignments()
    } catch (submitError) {
      console.error('Failed to submit assignment response:', submitError)
      setError('Unable to submit responses. Please retry.')
    } finally {
      setSubmittingResponse(false)
    }
  }

  return (
    <section className="ts-page assignment-page">
      <SectionHeader
        title="Assignments"
        subtitle={isTherapist ? 'Create reflective MCQs and track patient responses.' : 'Complete assignments shared by your therapist.'}
      />

      {error ? (
        <Card className="assignment-banner assignment-banner--error">
          <p>{error}</p>
        </Card>
      ) : null}

      {success ? (
        <Card className="assignment-banner assignment-banner--success">
          <p>{success}</p>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <p className="ts-text-secondary">Loading assignments...</p>
        </Card>
      ) : null}

      {!loading && isTherapist ? (
        <div className="assignment-therapist-grid">
          <Card className="assignment-composer">
            <div className="ts-card-header">
              <h2 className="ts-section-title">Create Assignment</h2>
              <div className="ts-row-actions">
                <label className="assignment-ai-count-label" htmlFor="assignment-ai-count">AI count</label>
                <input
                  id="assignment-ai-count"
                  type="number"
                  min={MIN_AI_COUNT}
                  max={MAX_AI_COUNT}
                  className="ts-input assignment-ai-count"
                  value={aiQuestionCount}
                  onChange={(event) => setAiQuestionCount(event.target.value)}
                />
                <button
                  type="button"
                  className="ts-btn ts-btn--outline"
                  onClick={handleGenerateWithAi}
                  disabled={generatingAi}
                >
                  {generatingAi ? 'Generating...' : 'Generate with AI'}
                </button>
              </div>
            </div>

            <div className="assignment-form-fields">
              <div>
                <p className="ts-field-label">Title</p>
                <input
                  type="text"
                  className="ts-input"
                  placeholder="Weekly Emotional Reflection"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>

              <div>
                <p className="ts-field-label">Patient</p>
                <select
                  className="ts-select"
                  value={selectedPatientId}
                  onChange={(event) => setSelectedPatientId(event.target.value)}
                >
                  <option value="">Select patient</option>
                  {patientOptions.map((patient) => (
                    <option key={patient.id} value={patient.id}>{patient.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="assignment-question-stack">
              {questions.map((question, questionIndex) => (
                <Card key={question.id} className="assignment-question-card">
                  <div className="ts-card-header">
                    <h3 className="assignment-question-title">Question {questionIndex + 1}</h3>
                    <button
                      type="button"
                      className="ts-link"
                      onClick={() => removeQuestion(question.id)}
                      disabled={questions.length <= 1}
                    >
                      Remove
                    </button>
                  </div>

                  <textarea
                    className="ts-input ts-textarea"
                    placeholder="Enter question text"
                    value={question.questionText}
                    onChange={(event) => updateQuestionText(question.id, event.target.value)}
                  />

                  <div className="assignment-options-grid">
                    {question.options.map((option, optionIndex) => (
                      <input
                        key={`${question.id}_${optionIndex}`}
                        className="ts-input"
                        type="text"
                        placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`}
                        value={option}
                        onChange={(event) => updateQuestionOption(question.id, optionIndex, event.target.value)}
                      />
                    ))}
                  </div>

                  <input
                    className="ts-input"
                    type="text"
                    placeholder="Recommended answer (therapist-guided)"
                    value={question.correctAnswer}
                    onChange={(event) => updateQuestionCorrectAnswer(question.id, event.target.value)}
                  />

                  <textarea
                    className="ts-input ts-textarea"
                    placeholder="Short supportive explanation for the recommended answer"
                    value={question.explanation || ''}
                    onChange={(event) => updateQuestionExplanation(question.id, event.target.value)}
                  />
                </Card>
              ))}
            </div>

            <div className="ts-row-actions">
              <button type="button" className="ts-btn ts-btn--outline" onClick={addQuestion}>Add Question</button>
              <button type="button" className="ts-btn ts-btn--green" onClick={handleCreateAssignment} disabled={saving}>
                {saving ? 'Sending...' : 'Send to Patient'}
              </button>
            </div>
          </Card>

          <div className="assignment-right-stack">
            <Card>
              <div className="ts-card-header">
                <h2 className="ts-section-title">Assignment Responses</h2>
                <span className="ts-text-secondary">{assignments.length} total</span>
              </div>

              {!assignments.length ? (
                <EmptyState
                  icon={<ClipboardIcon />}
                  title="No assignments yet"
                  description="Create your first assignment to start tracking patient reflection."
                />
              ) : (
                <div className="assignment-list">
                  {assignments.map((assignment) => {
                    const linkedPatient = patientOptions.find((item) => item.id === assignment.patientId)
                    const response = responsesByAssignmentId[assignment.id]
                    const submittedLabel = response?.completedAt
                      ? response.completedAt.toLocaleString()
                      : 'Not submitted yet'
                    const insights = buildInsightSummary(assignment, response)
                    const score = response?.score
                    const scoreLabel = score && Number.isFinite(Number(score.scaledOutOf10))
                      ? `${Number(score.scaledOutOf10)} / 10 · ${score.label || getScoreLabel(Number(score.scaledOutOf10))}`
                      : 'Pending'

                    return (
                      <Card key={assignment.id} className="assignment-list-card">
                        <div className="assignment-list-head">
                          <div>
                            <h3>{assignment.title}</h3>
                            <p>
                              {linkedPatient?.name || assignment.patientId || 'Patient'} · {assignment.questions.length} questions
                            </p>
                          </div>
                          <span className={`assignment-status assignment-status--${assignment.status}`}>{assignment.status}</span>
                        </div>

                        <div className="assignment-list-body">
                          <p><strong>Completed:</strong> {submittedLabel}</p>
                          <p><strong>Reflection Score:</strong> {scoreLabel}</p>
                          <p><strong>Time Taken:</strong> {formatDuration(Number(response?.timeTakenSeconds || 0))}</p>
                          {response?.answers?.length ? (
                            <ul className="assignment-answer-list">
                              {response.answers.map((answer) => (
                                <li key={`${assignment.id}_${answer.questionIndex}`}>
                                  Q{Number(answer.questionIndex) + 1}: {answer.selectedOption}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="ts-text-secondary">No responses yet.</p>
                          )}

                          <div className="assignment-insight-box">
                            {insights.map((insight) => (
                              <p key={`${assignment.id}_${insight}`}>{insight}</p>
                            ))}
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {!loading && !isTherapist ? (
        <div className="assignment-patient-grid">
          <Card>
            <div className="ts-card-header">
              <h2 className="ts-section-title">Assigned to You</h2>
              <span className="ts-text-secondary">{assignments.length} assignments</span>
            </div>

            {!assignments.length ? (
              <EmptyState
                icon={<ClipboardIcon />}
                title="No assignments available"
                description="Your therapist will assign reflective questionnaires here."
              />
            ) : (
              <>
                {pendingAssignments.length ? (
                  <div className="assignment-patient-list">
                    {pendingAssignments.map((assignment) => (
                      <button
                        key={assignment.id}
                        type="button"
                        className={`assignment-list-selector ${activeAssignmentId === assignment.id ? 'is-active' : ''}`}
                        onClick={() => setActiveAssignmentId(assignment.id)}
                      >
                        <div>
                          <p className="assignment-list-selector__title">{assignment.title}</p>
                          <p className="assignment-list-selector__meta">
                            {(assignment.createdAt && assignment.createdAt.toLocaleDateString()) || 'Recently assigned'} · {assignment.questions.length} questions
                          </p>
                        </div>
                        <span className="assignment-status assignment-status--assigned">assigned</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="ts-text-secondary">No pending assignments.</p>
                )}

                {completedAssignments.length ? (
                  <div className="assignment-completed-block">
                    <p className="ts-field-label">Completed</p>
                    <div className="assignment-completed-list">
                      {completedAssignments.map((assignment) => (
                        <div key={assignment.id} className="assignment-completed-item">
                          <span>{assignment.title}</span>
                          <span className="assignment-status assignment-status--completed">completed</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            {activeAssignment ? (
              <>
                <div className="ts-card-header">
                  <h2 className="ts-section-title">{activeAssignment.title}</h2>
                  <span className={`assignment-status assignment-status--${activeAssignment.status}`}>{activeAssignment.status}</span>
                </div>

                {activeResponse ? (
                  <div className="assignment-result-stack">
                    <Card className="assignment-results-overall">
                      <h3>Great effort on completing this reflection</h3>
                      <p>You&apos;re building awareness step by step.</p>
                    </Card>

                    {activeScore ? (
                      <Card className="assignment-score-card">
                        <div className="assignment-score-head">
                          <h3>Reflection Score: {activeScore.scaledOutOf10} / 10</h3>
                          <span>{activeScore.label}</span>
                        </div>
                        <div className="assignment-score-track" aria-hidden="true">
                          <div className="assignment-score-fill" style={{ width: `${Math.max(0, Math.min(100, activeScore.scaledOutOf10 * 10))}%` }} />
                        </div>
                      </Card>
                    ) : null}

                    <Card>
                      <h3 className="assignment-section-title">Answer Review</h3>
                      <div className="assignment-review-list">
                        {activeAssignment.questions.map((question, questionIndex) => {
                          const selected = selectedAnswers[questionIndex] || 'No response selected'
                          const recommended = question.correctAnswer || 'No recommended option provided'
                          const explanation = question.explanation || DEFAULT_EXPLANATION
                          return (
                            <Card key={`${activeAssignment.id}_review_${questionIndex}`} className="assignment-review-card">
                              <p className="assignment-attempt-question">Q{questionIndex + 1}. {question.questionText}</p>
                              <p className="assignment-pill assignment-pill--selected">Your response: {selected}</p>
                              <p className="assignment-pill assignment-pill--recommended">Recommended response: {recommended}</p>
                              <p className="assignment-review-explanation">{explanation}</p>
                            </Card>
                          )
                        })}
                      </div>
                    </Card>

                    <Card>
                      <h3 className="assignment-section-title">Insights</h3>
                      <div className="assignment-insight-box">
                        {(activeResponse.insights || buildEncouragingInsights(activeAssignment, activeResponse.answers)).map((insight) => (
                          <p key={`insight_${insight}`}>{insight}</p>
                        ))}
                      </div>
                    </Card>

                    <Card className="assignment-results-overall">
                      <h3>Keep practicing these strategies in your daily life</h3>
                      <p>Discuss these responses with your therapist in your next session.</p>
                    </Card>
                  </div>
                ) : (
                  <>
                    <div className="assignment-attempt-list">
                      {activeAssignment.questions.map((question, questionIndex) => (
                        <Card key={`${activeAssignment.id}_${questionIndex}`} className="assignment-attempt-card">
                          <p className="assignment-attempt-question">Q{questionIndex + 1}. {question.questionText}</p>
                          <div className="assignment-radio-group">
                            {(question.options || []).map((option, optionIndex) => {
                              const optionId = `${activeAssignment.id}_${questionIndex}_${optionIndex}`
                              const isChecked = selectedAnswers[questionIndex] === option
                              return (
                                <label key={optionId} htmlFor={optionId} className="assignment-radio-option">
                                  <input
                                    id={optionId}
                                    type="radio"
                                    name={`assignment_question_${questionIndex}`}
                                    checked={isChecked}
                                    onChange={() => handleSelectAnswer(questionIndex, option)}
                                  />
                                  <span>{option}</span>
                                </label>
                              )
                            })}
                          </div>
                        </Card>
                      ))}
                    </div>

                    <div className="ts-row-actions">
                      <button
                        type="button"
                        className="ts-btn ts-btn--green"
                        onClick={handleSubmitResponse}
                        disabled={submittingResponse || activeAssignment.status === 'completed'}
                      >
                        {submittingResponse ? 'Submitting...' : 'Submit Responses'}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <EmptyState
                icon={<ClipboardIcon />}
                title="Select an assignment"
                description="Choose one pending assignment to start answering questions."
              />
            )}
          </Card>
        </div>
      ) : null}
    </section>
  )
}
