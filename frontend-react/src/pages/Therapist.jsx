import { useEffect, useMemo, useRef, useState } from 'react'
import { socket } from '../lib/socket'
import { apiUrl } from '../lib/api'
import { useLocation, useNavigate } from 'react-router-dom'
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import CallTopbar from '../components/CallTopbar'
import Sidebar from '../layout/Sidebar'
import EmotionPanel from '../components/EmotionPanel'
import EmotionGraph from '../components/Graph'
import SessionReportCard from '../components/SessionReportCard'
import VideoControls from '../components/VideoControls'
import useDraggablePip from '../hooks/useDraggablePip'
import { generateReportPDF } from '../utils/generatePDF'
import { buildSerienReport } from '../utils/reportBuilder'
import { buildSessionMetadata, calculateStressScore, deriveMoodState } from '../utils/sessionAnalytics'
import { firebaseAuth, firestoreDb } from '../lib/firebase'

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
if (import.meta.env.VITE_TURN_URL && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) {
  iceServers.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  })
}

const rtcConfiguration = { iceServers }

const MAX_CALL_RETRIES = 1
const SIGNAL_DETECT_TIMEOUT_MS = 1500

function getSessionId() {
  const searchParams = new URLSearchParams(window.location.search)
  return sessionStorage.getItem('activeSessionId') || searchParams.get('sessionId') || ''
}

function logPeerState(label, pc) {
  console.log(`${label} signalingState:`, pc.signalingState)
  console.log(`${label} connectionState:`, pc.connectionState)
  console.log(`${label} iceConnectionState:`, pc.iceConnectionState)
  console.log(`${label} iceGatheringState:`, pc.iceGatheringState)
}

function attachStreamToVideo(videoElement, stream, label, handlers = {}) {
  if (!videoElement || !stream) return

  videoElement.srcObject = stream
  console.log(`${label} srcObject assigned:`, stream.id)
  videoElement
    .play()
    .then(() => {
      console.log(`${label} play() succeeded`)
      handlers.onPlayStarted?.()
    })
    .catch((error) => {
      console.warn(`${label} play() blocked:`, error)
      handlers.onPlayBlocked?.()
    })
}

const TIMELINE_LIMIT = 30
const STRESS_ALERT_THRESHOLD = 0.72
const ALERT_COOLDOWN_MS = 4000
const FACE_API_SCRIPT_CANDIDATES = [
  '/face-api.js',
]
const MODEL_URL = `${window.location.origin}/models`
const MODEL_LOAD_TIMEOUT_MS = 15000
const EMOTION_MODEL_OPTIONS = [
  { key: 'face-api', label: 'face-api.js (default)' },
  { key: 'keras-h5', label: 'facialemotionmodel (.h5/.json)' },
]
const EMOTION_MODEL_LABELS = {
  'face-api': 'face-api.js',
  'keras-h5': 'facialemotionmodel (.h5/.json)',
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatNow() {
  const date = new Date()
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function getTopEmotion(expressions) {
  if (!expressions) return null

  const scores = Object.entries(expressions)
    .filter(([, score]) => typeof score === 'number')
    .map(([emotion, score]) => ({ emotion, score }))

  if (!scores.length) return null

  let best = null
  for (const { emotion, score } of scores) {
    if (typeof score !== 'number') continue
    if (!best || score > best.score) {
      best = { emotion, score }
    }
  }

  const neutral = scores.find((item) => item.emotion === 'neutral')?.score || 0
  const happy = scores.find((item) => item.emotion === 'happy')?.score || 0
  const sad = scores.find((item) => item.emotion === 'sad')?.score || 0
  const fearful = scores.find((item) => item.emotion === 'fearful')?.score || 0

  // face-api often over-predicts neutral under low light; surface sad/fearful when they are meaningfully present.
  if (best && (best.emotion === 'neutral' || best.emotion === 'happy')) {
    if (fearful >= 0.16 && best.score - fearful <= 0.24) {
      return { emotion: 'fearful', score: fearful }
    }

    if (sad >= 0.18 && best.score - sad <= 0.22) {
      return { emotion: 'sad', score: sad }
    }
  }

  // If both stress emotions are present, prioritize the stronger one.
  if (fearful >= 0.2 && sad >= 0.2) {
    return fearful >= sad ? { emotion: 'fearful', score: fearful } : { emotion: 'sad', score: sad }
  }

  return best
}

function drawEmotionTag(ctx, box, text) {
  ctx.font = '16px Arial'
  ctx.textBaseline = 'top'

  const px = 6
  const py = 4
  const width = ctx.measureText(text).width + px * 2
  const height = 22

  let x = box.x
  let y = box.y - height - 2
  if (y < 0) y = box.y + 2

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(x, y, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x + px, y + py)
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

async function checkUrl(url) {
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}

async function resolveFaceApiEndpoints() {
  const scriptUrl = FACE_API_SCRIPT_CANDIDATES[0]
  const tinyManifest = `${MODEL_URL}/tiny_face_detector_model-weights_manifest.json`
  const expressionManifest = `${MODEL_URL}/face_expression_model-weights_manifest.json`
  const tinyOk = await checkUrl(tinyManifest)
  const exprOk = await checkUrl(expressionManifest)

  if (!tinyOk || !exprOk) {
    throw new Error(
      'Face model files are not reachable. Ensure Node server is running and /models serves tiny_face_detector_model-weights_manifest.json and face_expression_model-weights_manifest.json.'
    )
  }

  return { scriptUrl }
}

async function ensureFaceApiLoaded(scriptUrl) {
  if (window.faceapi) return window.faceapi

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-face-api="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load face-api.js')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = scriptUrl
    script.async = true
    script.dataset.faceApi = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load face-api.js'))
    document.body.appendChild(script)
  })

  return window.faceapi
}

export default function Therapist() {
  const navigate = useNavigate()
  const location = useLocation()
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const remoteFallbackStreamRef = useRef(null)
  const stageRef = useRef(null)
  const pipRef = useRef(null)
  const canvasRef = useRef(null)
  const socketRef = useRef(null)
  const pcRef = useRef(null)
  const localStreamRef = useRef(null)
  const sessionIdRef = useRef('')
  const signalingModeRef = useRef('unknown')
  const signalingDetectTimerRef = useRef(null)
  const detectionIntervalRef = useRef(null)
  const overlaySizeRef = useRef(null)
  const endCallRef = useRef(false)
  const politeRef = useRef(true)
  const isMakingOfferRef = useRef(false)
  const ignoreOfferRef = useRef(false)
  const pendingIceCandidatesRef = useRef([])
  const pendingOfferRef = useRef(null)
  const remoteDescriptionSetRef = useRef(false)
  const localMediaReadyRef = useRef(false)
  const peerConnectedRef = useRef(false)
  const pendingNegotiationRef = useRef(false)
  const retryCountRef = useRef(0)
  const sessionStartRef = useRef(new Date())
  const lastEmotionRef = useRef('')
  const lastMoodRef = useRef('')
  const lastAlertAtRef = useRef(0)
  const alertEventsRef = useRef([])
  const moodTransitionsRef = useRef([])

  const [status, setStatus] = useState('Connecting...')
  const [currentEmotion, setCurrentEmotion] = useState('-')
  const [currentConfidence, setCurrentConfidence] = useState(0)
  const [currentStressScore, setCurrentStressScore] = useState(0)
  const [lastTimestamp, setLastTimestamp] = useState('-')
  const [timeline, setTimeline] = useState([])
  const [liveAlert, setLiveAlert] = useState(null)
  const [showReport, setShowReport] = useState(false)
  const [sessionStartTime] = useState(new Date())
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelLoadError, setModelLoadError] = useState('')
  const [therapistSelectedModel, setTherapistSelectedModel] = useState(() => {
    const stored = window.localStorage.getItem('serien-therapist-emotion-model')
    return stored === 'keras-h5' ? 'keras-h5' : 'face-api'
  })
  const [kerasModelFilesAvailable, setKerasModelFilesAvailable] = useState(false)
  const [activeEmotionEngine, setActiveEmotionEngine] = useState('face-api')
  const [modelRoutingNote, setModelRoutingNote] = useState('')
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [remoteStream, setRemoteStream] = useState(null)
  const [remotePlayBlocked, setRemotePlayBlocked] = useState(false)
  const [sessionNotes, setSessionNotes] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('serien-sidebar-width') || 0)
    return Number.isFinite(stored) && stored >= 300 && stored <= 420 ? stored : 320
  })
  const [sessionContext, setSessionContext] = useState({
    sessionId: '',
    patientId: '',
    therapistId: '',
    patientName: '',
    therapistName: '',
  })
  const { position, onPointerDown } = useDraggablePip(stageRef, pipRef)

  const labels = useMemo(() => timeline.map((item) => item.time), [timeline])
  const happy = useMemo(() => timeline.map((t) => t.expressions?.happy || 0), [timeline])
  const neutral = useMemo(() => timeline.map((t) => t.expressions?.neutral || 0), [timeline])
  const sad = useMemo(() => timeline.map((t) => t.expressions?.sad || 0), [timeline])
  const angry = useMemo(() => timeline.map((t) => t.expressions?.angry || 0), [timeline])
  const fearful = useMemo(() => timeline.map((t) => t.expressions?.fearful || 0), [timeline])

  useEffect(() => {
    sessionIdRef.current = getSessionId()
  }, [location.search])

  useEffect(() => {
    if (!remoteStream || !remoteVideoRef.current) return

    attachStreamToVideo(remoteVideoRef.current, remoteStream, 'Therapist remote video', {
      onPlayBlocked: () => setRemotePlayBlocked(true),
      onPlayStarted: () => setRemotePlayBlocked(false),
    })
  }, [remoteStream])

  async function handleResumeRemotePlayback() {
    if (!remoteVideoRef.current) return
    try {
      await remoteVideoRef.current.play()
      setRemotePlayBlocked(false)
    } catch {
      setStatus('Tap video once to allow playback on this device.')
    }
  }

  useEffect(() => {
    function handleResizeStart(event) {
      if (window.innerWidth < 1024) return

      const startX = event?.detail?.clientX || 0
      const startWidth = sidebarWidth

      function onMouseMove(moveEvent) {
        const next = Math.min(420, Math.max(300, startWidth + (moveEvent.clientX - startX)))
        setSidebarWidth(next)
      }

      function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('serien-sidebar-resize-start', handleResizeStart)
    return () => window.removeEventListener('serien-sidebar-resize-start', handleResizeStart)
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('serien-sidebar-width', String(Math.round(sidebarWidth)))
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('serien-therapist-emotion-model', therapistSelectedModel)
  }, [therapistSelectedModel])

  useEffect(() => {
    let cancelled = false

    async function checkKerasFiles() {
      const [kerasJsonOk, kerasWeightsOk] = await Promise.all([
        checkUrl('/models/facialemotionmodel.json'),
        checkUrl('/models/facialemotionmodel.h5'),
      ])

      if (!cancelled) {
        setKerasModelFilesAvailable(kerasJsonOk && kerasWeightsOk)
      }
    }

    checkKerasFiles().catch(() => {
      if (!cancelled) {
        setKerasModelFilesAvailable(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function resolveRouting() {
      if (therapistSelectedModel !== 'keras-h5') {
        if (!cancelled) {
          setActiveEmotionEngine('face-api')
          setModelRoutingNote('')
        }
        return
      }

      const kerasJsonOk = await checkUrl('/models/facialemotionmodel.json')
      const kerasWeightsOk = await checkUrl('/models/facialemotionmodel.h5')
      if (cancelled) return

      setActiveEmotionEngine('face-api')
      setKerasModelFilesAvailable(kerasJsonOk && kerasWeightsOk)

      if (kerasJsonOk && kerasWeightsOk) {
        setModelRoutingNote('Therapist selected facialemotionmodel. Browser inference for Keras .h5 is not enabled yet, so face-api.js is running.')
      } else {
        setTherapistSelectedModel('face-api')
        setModelRoutingNote('Therapist selected facialemotionmodel, but /models/facialemotionmodel.json and /models/facialemotionmodel.h5 are not both available. Using face-api.js.')
      }
    }

    resolveRouting().catch((error) => {
      console.error('Failed to resolve model routing:', error)
      if (!cancelled) {
        setActiveEmotionEngine('face-api')
        setModelRoutingNote('Could not validate patient-selected model files. Using face-api.js.')
      }
    })

    return () => {
      cancelled = true
    }
  }, [therapistSelectedModel])

  const reportPreview = useMemo(() => {
    return {
      ...buildSerienReport({
        sessionId: sessionContext.sessionId,
        patientId: sessionContext.patientId,
        therapistId: sessionContext.therapistId,
        patientName: sessionContext.patientName,
        therapistName: sessionContext.therapistName,
        timeline,
        labels,
        happy,
        neutral,
        sad,
        angry,
        fearful,
        sessionNotes,
        sessionStart: sessionStartRef.current,
        sessionEnd: new Date(),
      }),
      createdAt: new Date(),
    }
  }, [angry, fearful, happy, labels, neutral, sad, sessionContext, sessionNotes, timeline])

  function logConnectionState(pc) {
    console.log('Therapist PC signalingState:', pc.signalingState)
    console.log('Therapist PC connectionState:', pc.connectionState)
    console.log('Therapist PC iceConnectionState:', pc.iceConnectionState)
    console.log('Therapist PC iceGatheringState:', pc.iceGatheringState)
  }

  async function flushQueuedCandidates(pc) {
    if (!remoteDescriptionSetRef.current || !pendingIceCandidatesRef.current.length) return

    const queued = [...pendingIceCandidatesRef.current]
    pendingIceCandidatesRef.current = []

    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate)
      } catch (error) {
        console.error('Error adding queued therapist ICE candidate:', error)
      }
    }
  }

  function addLocalTracksToPeer(pc) {
    const stream = localStreamRef.current
    if (!pc || !stream) return

    stream.getTracks().forEach((track) => {
      const sender = pc.getSenders().find((item) => item.track && item.track.kind === track.kind)
      if (!sender) {
        pc.addTrack(track, stream)
      }
    })

    console.log('Therapist local tracks:', stream.getTracks())
    console.log('Therapist sender count:', pc.getSenders().length)
  }

  function markModernSignaling() {
    signalingModeRef.current = 'modern'
    if (signalingDetectTimerRef.current) {
      clearTimeout(signalingDetectTimerRef.current)
      signalingDetectTimerRef.current = null
    }
  }

  function emitSignalPayload(payload) {
    const socket = socketRef.current
    if (!socket) return

    if (signalingModeRef.current === 'legacy') {
      if (payload.candidate) {
        socket.emit('ice-candidate', payload.candidate)
      } else if (payload.description?.type === 'offer') {
        socket.emit('offer', payload.description)
      } else if (payload.description?.type === 'answer') {
        socket.emit('answer', payload.description)
      }
      return
    }

    socket.emit('signal', payload)
  }

  function clearRemoteMedia() {
    setRemoteStream(null)
    setRemotePlayBlocked(false)
    remoteFallbackStreamRef.current = null
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null
    }
  }

  function destroyPeerConnection() {
    const pc = pcRef.current
    if (!pc) return

    pc.ontrack = null
    pc.onicecandidate = null
    pc.onconnectionstatechange = null
    pc.oniceconnectionstatechange = null
    pc.onsignalingstatechange = null
    pc.onicegatheringstatechange = null
    pc.onnegotiationneeded = null
    pc.close()
    pcRef.current = null
  }

  async function ensurePeerConnection() {
    if (pcRef.current) return pcRef.current

    pcRef.current = await createPeerConnection(socketRef.current)
    addLocalTracksToPeer(pcRef.current)
    return pcRef.current
  }

  function schedulePeerRestart(reason) {
    if (endCallRef.current || retryCountRef.current >= MAX_CALL_RETRIES) return
    retryCountRef.current += 1

    setTimeout(async () => {
      if (endCallRef.current) return

      console.log('Therapist rebuilding peer connection:', reason)
      destroyPeerConnection()
      remoteDescriptionSetRef.current = false
      pendingIceCandidatesRef.current = []
      clearRemoteMedia()

      const peerConnection = await ensurePeerConnection()
      if (peerConnectedRef.current && localMediaReadyRef.current && peerConnection.signalingState === 'stable') {
        pendingNegotiationRef.current = true
        peerConnection.onnegotiationneeded?.()
      }
    }, 400)
  }

  async function handleSignal(payload) {
    if (!payload?.sessionId || payload.sessionId !== sessionIdRef.current) {
      console.log('Therapist ignoring stale signal:', payload?.sessionId)
      return
    }

    const pc = await ensurePeerConnection()

    if (payload.candidate) {
      console.log('Therapist received ICE candidate')
      const candidate = new RTCIceCandidate(payload.candidate)
      if (!remoteDescriptionSetRef.current) {
        pendingIceCandidatesRef.current.push(candidate)
        return
      }

      try {
        await pc.addIceCandidate(candidate)
      } catch (error) {
        console.error('Therapist error adding ICE candidate:', error)
      }
      return
    }

    const description = payload.description
    if (!description) return

    console.log('Therapist received description:', description.type)
    const offerCollision = description.type === 'offer' && (isMakingOfferRef.current || pc.signalingState !== 'stable')
    ignoreOfferRef.current = !politeRef.current && offerCollision

    try {
      if (ignoreOfferRef.current) {
        console.warn('Therapist ignoring offer collision from impolite role')
        return
      }

      if (offerCollision) {
        await pc.setLocalDescription({ type: 'rollback' })
      }

      await pc.setRemoteDescription(description)
      remoteDescriptionSetRef.current = true
      await flushQueuedCandidates(pc)

      if (description.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        console.log('Therapist sending answer')
        emitSignalPayload({
          sessionId: sessionIdRef.current,
          role: 'therapist',
          description: pc.localDescription,
        })
      } else {
        setStatus('Answer received. Establishing media...')
      }
    } catch (error) {
      console.error('Therapist signal handling failed:', error)
    }
  }

  async function handleSessionState(sessionState) {
    if (!sessionState || sessionState.sessionId !== sessionIdRef.current) return

    peerConnectedRef.current = !!sessionState.patientConnected
    console.log('Therapist session-state:', sessionState)

    if (sessionState.patientConnected && localMediaReadyRef.current) {
      setStatus('Patient online. Preparing call...')
      if (pcRef.current?.signalingState === 'stable') {
        pendingNegotiationRef.current = true
        pcRef.current.onnegotiationneeded?.()
      }
    } else {
      setStatus('Waiting for patient...')
    }
  }

  async function createPeerConnection(socket) {
    const pc = new RTCPeerConnection({
      ...rtcConfiguration,
      iceCandidatePoolSize: 4,
    })

    pc.ontrack = (event) => {
      console.log('Therapist ontrack fired')
      console.log('Therapist track:', event.track?.kind, event.track?.readyState)
      console.log('Therapist remote stream received:', event.streams)

      let stream = event.streams?.[0]
      if (!stream) {
        if (!remoteFallbackStreamRef.current) {
          remoteFallbackStreamRef.current = new MediaStream()
        }
        remoteFallbackStreamRef.current.addTrack(event.track)
        stream = remoteFallbackStreamRef.current
      }

      setRemoteStream(stream)

      if (stream && remoteVideoRef.current) {
        attachStreamToVideo(remoteVideoRef.current, stream, 'Therapist remote video', {
          onPlayBlocked: () => setRemotePlayBlocked(true),
          onPlayStarted: () => setRemotePlayBlocked(false),
        })
        setStatus('Connected: patient video received.')
      }
    }

    pc.onicecandidate = (event) => {
      console.log('Therapist onicecandidate')
      if (event.candidate) {
        emitSignalPayload({
          sessionId: sessionIdRef.current,
          role: 'therapist',
          candidate: event.candidate,
        })
      }
    }

    pc.onnegotiationneeded = async () => {
      console.log('Therapist onnegotiationneeded')
      pendingNegotiationRef.current = true

      if (!localMediaReadyRef.current || !peerConnectedRef.current) {
        return
      }

      if (pc.signalingState !== 'stable' || isMakingOfferRef.current) {
        return
      }

      try {
        isMakingOfferRef.current = true
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        console.log('Therapist sending offer')
        emitSignalPayload({
          sessionId: sessionIdRef.current,
          role: 'therapist',
          description: pc.localDescription,
        })
      } catch (error) {
        console.error('Therapist negotiation failed:', error)
      } finally {
        isMakingOfferRef.current = false
        pendingNegotiationRef.current = false
      }
    }

    pc.onconnectionstatechange = () => {
      logConnectionState(pc)
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus('Connection failed. Re-establishing peer connection...')
        schedulePeerRestart('connection-state')
      }
    }

    pc.oniceconnectionstatechange = () => {
      logConnectionState(pc)
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        setStatus('ICE connection failed. Re-establishing peer connection...')
        schedulePeerRestart('ice-state')
      }
    }

    pc.onsignalingstatechange = () => logConnectionState(pc)
    pc.onicegatheringstatechange = () => logConnectionState(pc)

    return pc
  }

  useEffect(() => {
    async function loadSessionContext() {
      const sessionId = sessionStorage.getItem('activeSessionId') || ''
      const therapistId = firebaseAuth?.currentUser?.uid || ''
      let patientId = sessionStorage.getItem('activePatientId') || ''
      let patientName = sessionStorage.getItem('activePatientName') || ''
      let therapistName = firebaseAuth?.currentUser?.displayName || ''

      if (sessionId) {
        const sessionSnapshot = await getDoc(doc(firestoreDb, 'sessions', sessionId))
        if (sessionSnapshot.exists()) {
          const sessionData = sessionSnapshot.data()
          patientId = patientId || sessionData?.patientId || ''
          patientName = patientName || sessionData?.patientName || ''
          therapistName = therapistName || sessionData?.therapistName || ''
        }
      }

      if (!therapistName && therapistId) {
        const therapistSnapshot = await getDoc(doc(firestoreDb, 'users', therapistId))
        if (therapistSnapshot.exists()) {
          const therapistData = therapistSnapshot.data()
          therapistName = therapistData?.name || therapistData?.email || ''
        }
      }

      if (!patientName && patientId) {
        const patientSnapshot = await getDoc(doc(firestoreDb, 'users', patientId))
        if (patientSnapshot.exists()) {
          const user = patientSnapshot.data() || {}
          patientName = user.name || user.displayName || 'Unknown Patient'
        }
      }

      patientName = patientName || 'Unknown Patient'

      setSessionContext({
        sessionId,
        patientId,
        therapistId,
        patientName,
        therapistName,
      })
    }

    loadSessionContext().catch((error) => {
      console.error('Failed to load session context:', error)
    })
  }, [])

 useEffect(() => {
  const socket = io("https://serien-model.onrender.com", {
  transports: ["websocket"],
})
    socketRef.current = socket
    

    function cleanupConnections() {
      if (detectionIntervalRef.current) {
        window.clearInterval(detectionIntervalRef.current)
      }

      socket.removeAllListeners()
      socket.io.off('reconnect')
      socket.disconnect()

      if (signalingDetectTimerRef.current) {
        clearTimeout(signalingDetectTimerRef.current)
        signalingDetectTimerRef.current = null
      }

      destroyPeerConnection()
      clearRemoteMedia()

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop())
      }
    }

    async function startLocalMedia() {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = localStream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream
      }

      setMicEnabled(localStream.getAudioTracks().every((track) => track.enabled))
      setCameraEnabled(localStream.getVideoTracks().every((track) => track.enabled))
      localMediaReadyRef.current = true

      console.log('Therapist local tracks:', localStream.getTracks())

      const peerConnection = await ensurePeerConnection()
      addLocalTracksToPeer(peerConnection)

      if (peerConnectedRef.current && peerConnection.signalingState === 'stable') {
        pendingNegotiationRef.current = true
        peerConnection.onnegotiationneeded?.()
      }
    }

    function setupOverlay(faceapi) {
      if (!remoteVideoRef.current || !canvasRef.current) return

      const width = remoteVideoRef.current.clientWidth || remoteVideoRef.current.videoWidth
      const height = remoteVideoRef.current.clientHeight || remoteVideoRef.current.videoHeight

      overlaySizeRef.current = { width, height }
      canvasRef.current.width = width
      canvasRef.current.height = height
      faceapi.matchDimensions(canvasRef.current, overlaySizeRef.current)
    }

    function startEmotionLoop(faceapi) {
      if (detectionIntervalRef.current) return

      const detectorOptions = new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: 0.35,
      })

      detectionIntervalRef.current = window.setInterval(async () => {
        if (!overlaySizeRef.current || !remoteVideoRef.current || remoteVideoRef.current.readyState < 2) return
        if (!canvasRef.current) return

        const ctx = canvasRef.current.getContext('2d')
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)

        let detections = []
        try {
          detections = await faceapi.detectAllFaces(remoteVideoRef.current, detectorOptions).withFaceExpressions()
        } catch (error) {
          console.error('Emotion detection tick failed:', error)
          setLastTimestamp('Timestamp: - | Detection retrying...')
          return
        }

        if (!detections || detections.length === 0) {
          setCurrentEmotion('-')
          window.sessionStorage.removeItem('currentEmotion')
          window.sessionStorage.removeItem('latestEmotion')
          setLastTimestamp('Timestamp: -')
          return
        }

        const resized = faceapi.resizeResults(detections, overlaySizeRef.current)
        faceapi.draw.drawDetections(canvasRef.current, resized)

        for (let i = 0; i < resized.length; i += 1) {
          const expressions = detections[i].expressions
          const top = getTopEmotion(expressions)
          if (!top) continue

          const label = `${top.emotion} (${Math.round(top.score * 100)}%)`
          drawEmotionTag(ctx, resized[i].detection.box, label)

          if (i === 0) {
            const now = formatNow()
            const stressScore = calculateStressScore(expressions)
            const moodState = deriveMoodState(expressions, top.emotion)

            setCurrentEmotion(top.emotion.toUpperCase())
            window.sessionStorage.setItem('currentEmotion', top.emotion)
            window.sessionStorage.setItem('latestEmotion', top.emotion)
            window.localStorage.setItem('serien-current-emotion', top.emotion)
            setCurrentConfidence(top.score)
            setCurrentStressScore(stressScore)
            setLastTimestamp(`Timestamp: ${now} | Confidence: ${Math.round(top.score * 100)}%`)

            if (lastMoodRef.current && lastMoodRef.current !== moodState) {
              moodTransitionsRef.current = [
                ...moodTransitionsRef.current,
                {
                  time: now,
                  from: lastMoodRef.current,
                  to: moodState,
                },
              ].slice(-10)
            }
            lastMoodRef.current = moodState
            lastEmotionRef.current = top.emotion

            setTimeline((prev) => {
              const next = [
                ...prev,
                {
                  id: `${now}-${Math.random()}`,
                  time: now,
                  emotion: top.emotion,
                  confidence: top.score,
                  stressScore,
                  expressions: {
                    happy: expressions.happy || 0,
                    neutral: expressions.neutral || 0,
                    sad: expressions.sad || 0,
                    fearful: expressions.fearful || 0,
                    disgusted: expressions.disgusted || 0,
                    angry: expressions.angry || 0,
                    surprised: expressions.surprised || 0,
                  },
                },
              ]

              return next.length > TIMELINE_LIMIT ? next.slice(-TIMELINE_LIMIT) : next
            })

            if (stressScore >= STRESS_ALERT_THRESHOLD) {
              const nowMs = Date.now()
              if (nowMs - lastAlertAtRef.current >= ALERT_COOLDOWN_MS) {
                lastAlertAtRef.current = nowMs

                const alertEntry = {
                  time: now,
                  score: stressScore,
                  emotion: top.emotion,
                  message: `Stress alert: ${Math.round(stressScore * 100)}% detected from ${top.emotion}.`,
                }

                alertEventsRef.current = [...alertEventsRef.current, alertEntry].slice(-8)
                setLiveAlert({
                  severity: 'warning',
                  title: 'Live emotion alert',
                  message: alertEntry.message,
                  score: stressScore,
                  time: now,
                })
              }
            } else {
              setLiveAlert((prev) => (prev ? null : prev))
            }

            socket.emit('emotion_update', {
              emotion: top.emotion,
              confidence: top.score,
              timestamp: now,
            })
          }
        }
      }, 200)
    }

    function startDetectionIfRemoteReady(faceapi) {
      if (!remoteVideoRef.current?.srcObject) return

      const hasVideoSize =
        (remoteVideoRef.current.videoWidth || 0) > 0 &&
        (remoteVideoRef.current.videoHeight || 0) > 0

      if (remoteVideoRef.current.readyState >= 1 || hasVideoSize) {
        setupOverlay(faceapi)
        startEmotionLoop(faceapi)
        setStatus('Models loaded. Analyzing patient stream...')
      }
    }

    async function loadModelsAndFaceApi() {
      setStatus('Loading face-api models...')
      setModelLoadError('')
      const { scriptUrl } = await resolveFaceApiEndpoints()
      const faceapi = await withTimeout(
        ensureFaceApiLoaded(scriptUrl),
        MODEL_LOAD_TIMEOUT_MS,
        'Timed out while loading face-api.js script.'
      )
      await withTimeout(
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        MODEL_LOAD_TIMEOUT_MS,
        'Timed out while loading tiny face detector model.'
      )
      await withTimeout(
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        MODEL_LOAD_TIMEOUT_MS,
        'Timed out while loading face expression model.'
      )
      setModelsLoaded(true)
      setStatus(remoteVideoRef.current?.srcObject ? 'Models loaded. Analyzing patient stream...' : 'Models loaded. Waiting for patient stream...')
      return faceapi
    }

    socket.on('signal', handleSignal)

    socket.on('session-state', handleSessionState)

    socket.on('connect', () => {
      console.log('Therapist socket connected:', socket.id)
      socket.emit('join-session', { sessionId: sessionIdRef.current, role: 'therapist' })
      signalingModeRef.current = 'unknown'
      signalingDetectTimerRef.current = setTimeout(() => {
        if (signalingModeRef.current === 'unknown') {
          signalingModeRef.current = 'legacy'
          socket.emit('join-role', 'therapist')
          console.warn('Therapist falling back to legacy signaling mode')
        }
      }, SIGNAL_DETECT_TIMEOUT_MS)
      setStatus(sessionIdRef.current ? 'Connected to signaling server.' : 'Connected. Waiting for session ID...')
    })

    socket.on('disconnect', (reason) => {
      console.log('Therapist socket disconnected:', reason)
    })

    socket.io.on('reconnect', (attempt) => {
      console.log('Therapist socket reconnected:', attempt)
      socket.emit('join-session', { sessionId: sessionIdRef.current, role: 'therapist' })
    })

    socket.on('connect_error', (error) => {
      console.error('Therapist socket connect_error:', error)
    })

    socket.off('signal')
    socket.on('signal', (payload) => {
      markModernSignaling()
      handleSignal(payload)
    })

    socket.off('session-state')
    socket.on('session-state', (payload) => {
      markModernSignaling()
      handleSessionState(payload)
    })

    socket.on('offer', (offer) => {
      signalingModeRef.current = 'legacy'
      handleSignal({ sessionId: sessionIdRef.current, description: offer })
    })

    socket.on('answer', (answer) => {
      signalingModeRef.current = 'legacy'
      handleSignal({ sessionId: sessionIdRef.current, description: answer })
    })

    socket.on('ice-candidate', (candidate) => {
      signalingModeRef.current = 'legacy'
      handleSignal({ sessionId: sessionIdRef.current, candidate })
    })

    socket.on('peer-status', (peerStatus) => {
      signalingModeRef.current = 'legacy'
      handleSessionState({
        sessionId: sessionIdRef.current,
        patientConnected: !!peerStatus?.patientConnected,
      })
    })

    socket.on('join-session-ack', (payload) => {
      markModernSignaling()
      console.log('Therapist join-session-ack:', payload)
    })

    let faceapiInstance = null

    function handleLoadedMetadata() {
      if (faceapiInstance) {
        setupOverlay(faceapiInstance)
        startEmotionLoop(faceapiInstance)
        setStatus('Models loaded. Analyzing patient stream...')
      }
    }

    function handleResize() {
      if (remoteVideoRef.current?.srcObject && faceapiInstance) {
        setupOverlay(faceapiInstance)
      }
    }

    remoteVideoRef.current?.addEventListener('loadedmetadata', handleLoadedMetadata)
    window.addEventListener('resize', handleResize)

    async function init() {
      try {
        setStatus('Starting therapist setup...')
        await ensurePeerConnection()
        try {
          await startLocalMedia()
        } catch (mediaError) {
          console.error('Local media permission/setup failed:', mediaError)
          setStatus(`Local camera/mic unavailable (${mediaError?.message || 'permission denied'}). Continuing in receive-only mode...`)
        }

        try {
          faceapiInstance = await loadModelsAndFaceApi()
        } catch (err) {
          console.error('Model load failed:', err)
          throw err
        }
        startDetectionIfRemoteReady(faceapiInstance)
      } catch (error) {
        console.error(error)
        setModelLoadError(error?.message || 'unknown error')
        setStatus(`Could not load face models: ${error?.message || 'unknown error'}`)
      }
    }

    init()

    return () => {
      remoteVideoRef.current?.removeEventListener('loadedmetadata', handleLoadedMetadata)
      window.removeEventListener('resize', handleResize)

      if (!endCallRef.current) {
        cleanupConnections()
      }
    }
  }, [])

  function handleToggleMic() {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled
    })
    setMicEnabled(stream.getAudioTracks().every((track) => track.enabled))
  }

  function handleToggleCamera() {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled
    })
    setCameraEnabled(stream.getVideoTracks().every((track) => track.enabled))
  }

  async function saveReport() {
    const sessionId = sessionContext.sessionId || sessionStorage.getItem('activeSessionId')
    if (!sessionId) {
      console.warn('No activeSessionId found. Skipping report save.')
      return
    }

    const therapistId = sessionContext.therapistId || firebaseAuth?.currentUser?.uid || ''
    let patientId = sessionContext.patientId || sessionStorage.getItem('activePatientId') || ''

    if (!patientId) {
      const sessionSnapshot = await getDoc(doc(firestoreDb, 'sessions', sessionId))
      if (sessionSnapshot.exists()) {
        patientId = sessionSnapshot.data()?.patientId || ''
      }
    }

    let patientName = reportPreview.patientName || sessionStorage.getItem('activePatientName') || ''
    if (!patientName && patientId) {
      const patientSnapshot = await getDoc(doc(firestoreDb, 'users', patientId))
      if (patientSnapshot.exists()) {
        const user = patientSnapshot.data() || {}
        patientName = user.name || user.displayName || 'Unknown Patient'
      }
    }

    const reportPayload = {
      ...reportPreview,
      sessionId,
      patientId,
      therapistId,
      patientName: patientName || 'Unknown Patient',
      therapistName: reportPreview.therapistName || firebaseAuth?.currentUser?.displayName || 'Therapist',
      createdAt: serverTimestamp(),
    }

    const reportRef = await addDoc(collection(firestoreDb, 'reports'), reportPayload)

    fetch(apiUrl('/send-report-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        reportId: reportRef.id,
        summary: reportPayload.summary || reportPayload.emotionSummary || '',
        patientSummary: reportPayload.emotionSummary || reportPayload.summary || '',
        therapistSummary: reportPayload.summary || reportPayload.emotionSummary || '',
        reportLink: `${window.location.origin}/reports?sessionId=${sessionId}`,
      }),
    }).catch((error) => {
      console.error('Failed to send report email:', error)
    })
  }

  async function saveSessionMetadata() {
    const sessionId = sessionStorage.getItem('activeSessionId')
    if (!sessionId) return

    const therapistId = firebaseAuth?.currentUser?.uid || ''
    let patientId = sessionStorage.getItem('activePatientId') || ''

    if (!patientId) {
      const sessionSnapshot = await getDoc(doc(firestoreDb, 'sessions', sessionId))
      if (sessionSnapshot.exists()) {
        patientId = sessionSnapshot.data()?.patientId || ''
      }
    }

    const endedAt = new Date()
    const metadata = buildSessionMetadata({
      sessionId,
      therapistId,
      patientId,
      startedAt: sessionStartRef.current,
      endedAt,
      timeline,
      alertEvents: alertEventsRef.current,
      moodTransitions: moodTransitionsRef.current,
    })

    await setDoc(
      doc(firestoreDb, 'sessionMetadata', sessionId),
      {
        ...metadata,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    )
  }

  async function handleEndCall() {
    endCallRef.current = true

    if (detectionIntervalRef.current) {
      window.clearInterval(detectionIntervalRef.current)
    }

    if (socketRef.current) {
      socketRef.current.removeAllListeners()
      socketRef.current.io.off('reconnect')
      socketRef.current.disconnect()
    }

    if (signalingDetectTimerRef.current) {
      clearTimeout(signalingDetectTimerRef.current)
      signalingDetectTimerRef.current = null
    }

    destroyPeerConnection()

    clearRemoteMedia()

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop())
    }

    try {
      await saveReport()
      await saveSessionMetadata()
    } catch (error) {
      console.error('Failed to save report on call end:', error)
    }

    navigate('/therapist-home')
  }

  return (
    <div className="dashboard-shell call-dashboard-shell" style={{ '--sidebar-width': `${sidebarWidth}px` }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="dashboard-shell__content call-dashboard-content">
        <CallTopbar
          role="therapist"
          title="Therapist Session"
          subtitle="Live session"
          actionLabel={showReport ? 'Hide Report' : 'View Report'}
          onAction={() => setShowReport((value) => !value)}
          actionDisabled={timeline.length === 0}
        />

        <main className="call-dashboard-main">
          <div className="call-dashboard-grid">
            <section className="call-video-column">
              <div className="video-call-panel call-video-panel call-fade-in p-4">
                <div className="call-video-panel__header">
                  <div>
                    <h2 className="call-video-panel__title">Therapist Session</h2>
                    <p className="call-video-panel__status">{status}</p>
                  </div>
                  <div className="call-header-actions">
                    <label className="call-model-picker" htmlFor="therapist-emotion-model-picker">
                      <span className="call-model-picker__label">Emotion model</span>
                      <select
                        id="therapist-emotion-model-picker"
                        className="call-model-picker__select"
                        value={therapistSelectedModel}
                        onChange={(event) => setTherapistSelectedModel(event.target.value)}
                      >
                        {EMOTION_MODEL_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key} disabled={option.key === 'keras-h5' && !kerasModelFilesAvailable}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <span className={`call-connection-badge ${remoteStream ? 'is-connected' : ''}`}>
                      {remoteStream ? 'Connected' : 'Waiting for user...'}
                    </span>
                  </div>
                </div>

                <div ref={stageRef} className="video-call-stage call-stage call-stage--clean relative mt-3 w-full overflow-hidden">
                  <video
                    ref={remoteVideoRef}
                    className={`call-remote-video absolute inset-0 h-full w-full object-cover ${remoteStream ? 'is-connected' : ''}`}
                    autoPlay
                    playsInline
                  />
                  <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

                  {remoteStream && remotePlayBlocked ? (
                    <div className="call-play-overlay">
                      <button type="button" className="call-play-overlay__button" onClick={handleResumeRemotePlayback}>
                        Tap to resume remote video
                      </button>
                    </div>
                  ) : null}

                  {!remoteStream ? (
                    <div className="call-waiting-overlay">
                      <p className="call-waiting-overlay__title">Waiting for user...</p>
                      <p className="call-waiting-overlay__subtitle">Serien is ready. Video will appear once the patient joins.</p>
                    </div>
                  ) : null}

                  <div
                    ref={pipRef}
                    onPointerDown={onPointerDown}
                    className="video-call-stage__pip call-pip absolute h-36 w-56 cursor-grab overflow-hidden rounded-xl bg-black/70 active:cursor-grabbing"
                    style={{ left: `${position.x}px`, top: `${position.y}px` }}
                  >
                    <video ref={localVideoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
                  </div>
                </div>

                <VideoControls
                  micOn={micEnabled}
                  cameraOn={cameraEnabled}
                  onToggleMic={handleToggleMic}
                  onToggleCamera={handleToggleCamera}
                  onEndCall={handleEndCall}
                  onOpenNotes={() => setShowReport(true)}
                  onOpenReport={() => setShowReport((value) => !value)}
                  showUtilityButtons
                />

                {liveAlert ? (
                  <div className="call-alert-box mt-4">
                    <p className="font-semibold">{liveAlert.title}</p>
                    <p className="mt-1">{liveAlert.message}</p>
                  </div>
                ) : null}
              </div>

              {showReport && timeline.length > 0 ? (
                <section className="video-call-panel call-fade-in p-4" style={{ marginTop: '1rem' }}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="call-heading">Session Report</h2>
                    <button
                      type="button"
                      onClick={() => generateReportPDF(`session-report-${new Date().getTime()}`, 'live-session-report')}
                      className="call-report-download"
                    >
                      Download PDF
                    </button>
                  </div>
                  <label className="mb-3 block text-sm text-slate-200">
                    Session Notes
                    <textarea
                      rows={3}
                      value={sessionNotes}
                      onChange={(event) => setSessionNotes(event.target.value)}
                      className="call-notes-input mt-1"
                      placeholder="Add therapist notes for this report..."
                    />
                  </label>
                  <SessionReportCard report={reportPreview} elementId="live-session-report" />
                </section>
              ) : null}
            </section>

            <section className="call-analytics-column">
              <button
                type="button"
                className="call-analytics-toggle"
                onClick={() => setAnalyticsOpen((value) => !value)}
              >
                {analyticsOpen ? 'Hide analytics' : 'Show analytics'}
              </button>

              <aside className={`call-analytics-rail ${analyticsOpen ? 'is-open' : ''}`}>
                <EmotionPanel
                  currentEmotion={currentEmotion}
                  confidence={currentConfidence}
                  timeline={timeline}
                  showTimeline={false}
                  alert={liveAlert}
                />

                <div className="call-analytics-card call-fade-in">
                  <div className="call-analytics-card__head">
                    <h2 className="call-analytics-card__title">Emotion Analytics</h2>
                    <span className="call-analytics-card__meta">Live graph</span>
                  </div>
                  <div className="call-graph-wrap">
                    <EmotionGraph labels={labels} happy={happy} neutral={neutral} sad={sad} angry={angry} fearful={fearful} tone="light" />
                  </div>
                </div>

                <div className="call-analytics-card call-fade-in">
                  <p className="call-analytics-card__title">Timeline</p>
                  <ul className="call-timeline-list">
                    {timeline.length === 0 ? (
                      <li className="call-timeline-empty">No data yet</li>
                    ) : (
                      timeline.map((item) => (
                        <li key={item.id} className="call-timeline-item">
                          <div className="call-timeline-item__row">
                            <span className="call-timeline-item__emotion">{item.emotion}</span>
                            <span className="call-timeline-item__score">{Math.round(item.confidence * 100)}%</span>
                          </div>
                          <p className="call-timeline-item__time">{item.time}</p>
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                {modelLoadError ? (
                  <div className="call-analytics-card call-analytics-card--alert">Face model load failed: {modelLoadError}</div>
                ) : null}

                <div className="call-analytics-card call-fade-in">
                  <p className="call-analytics-card__title">Model Routing</p>
                  <p className="call-analytics-card__meta">Selected by therapist: {EMOTION_MODEL_LABELS[therapistSelectedModel] || 'face-api.js'}</p>
                  <p className="call-analytics-card__meta">Active engine: {EMOTION_MODEL_LABELS[activeEmotionEngine] || 'face-api.js'}</p>
                  {modelRoutingNote ? <p className="call-analytics-card__text">{modelRoutingNote}</p> : null}
                </div>

                {!modelsLoaded && !modelLoadError ? (
                  <div className="call-analytics-card">Face models are still loading...</div>
                ) : null}
              </aside>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
