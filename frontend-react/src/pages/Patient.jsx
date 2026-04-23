import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { useLocation, useNavigate } from 'react-router-dom'
import CallTopbar from '../components/CallTopbar'
import Sidebar from '../layout/Sidebar'
import VideoControls from '../components/VideoControls'
import useDraggablePip from '../hooks/useDraggablePip'

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

export default function Patient() {
  const navigate = useNavigate()
  const location = useLocation()
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const remoteFallbackStreamRef = useRef(null)
  const stageRef = useRef(null)
  const pipRef = useRef(null)
  const socketRef = useRef(null)
  const pcRef = useRef(null)
  const localStreamRef = useRef(null)
  const sessionIdRef = useRef('')
  const politeRef = useRef(false)
  const signalingModeRef = useRef('unknown')
  const signalingDetectTimerRef = useRef(null)
  const isMakingOfferRef = useRef(false)
  const ignoreOfferRef = useRef(false)
  const pendingIceCandidatesRef = useRef([])
  const remoteDescriptionSetRef = useRef(false)
  const localMediaReadyRef = useRef(false)
  const peerConnectedRef = useRef(false)
  const pendingNegotiationRef = useRef(false)
  const retryCountRef = useRef(0)
  const endCallRef = useRef(false)
  const [status, setStatus] = useState('Starting...')
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [remoteStream, setRemoteStream] = useState(null)
  const [remotePlayBlocked, setRemotePlayBlocked] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('serien-sidebar-width') || 0)
    return Number.isFinite(stored) && stored >= 300 && stored <= 420 ? stored : 320
  })
  const { position, onPointerDown } = useDraggablePip(stageRef, pipRef)

  useEffect(() => {
    sessionIdRef.current = getSessionId()
  }, [location.search])

  useEffect(() => {
    if (!remoteStream || !remoteVideoRef.current) return

    attachStreamToVideo(remoteVideoRef.current, remoteStream, 'Patient remote video', {
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

  async function flushQueuedCandidates(pc) {
    if (!remoteDescriptionSetRef.current || !pendingIceCandidatesRef.current.length) return

    const queued = [...pendingIceCandidatesRef.current]
    pendingIceCandidatesRef.current = []

    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate)
      } catch (error) {
        console.error('Error adding queued ICE candidate:', error)
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

    console.log('Patient local tracks:', stream.getTracks())
    console.log('Patient sender count:', pc.getSenders().length)
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

  function buildPeerConnection() {
    const pc = new RTCPeerConnection({
      ...rtcConfiguration,
      iceCandidatePoolSize: 4,
    })

    pc.ontrack = (event) => {
      console.log('Patient ontrack fired')
      console.log('Patient track:', event.track?.kind, event.track?.readyState)
      console.log('Patient remote stream received:', event.streams)

      let stream = event.streams?.[0]
      if (!stream) {
        if (!remoteFallbackStreamRef.current) {
          remoteFallbackStreamRef.current = new MediaStream()
        }
        remoteFallbackStreamRef.current.addTrack(event.track)
        stream = remoteFallbackStreamRef.current
      }

      setRemoteStream(stream)
      attachStreamToVideo(remoteVideoRef.current, stream, 'Patient remote video', {
        onPlayBlocked: () => setRemotePlayBlocked(true),
        onPlayStarted: () => setRemotePlayBlocked(false),
      })
      setStatus('Connected: therapist media received.')
    }

    pc.onicecandidate = (event) => {
      console.log('Patient onicecandidate')
      if (event.candidate) {
        emitSignalPayload({
          sessionId: sessionIdRef.current,
          role: 'patient',
          candidate: event.candidate,
        })
      }
    }

    pc.onnegotiationneeded = async () => {
      console.log('Patient onnegotiationneeded')
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
        console.log('Patient sending offer')
        emitSignalPayload({
          sessionId: sessionIdRef.current,
          role: 'patient',
          description: pc.localDescription,
        })
      } catch (error) {
        console.error('Patient negotiation failed:', error)
      } finally {
        isMakingOfferRef.current = false
        pendingNegotiationRef.current = false
      }
    }

    pc.onsignalingstatechange = () => logPeerState('Patient PC', pc)
    pc.onconnectionstatechange = () => {
      logPeerState('Patient PC', pc)
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setStatus('Connection unstable. Reconnecting...')
        schedulePeerRestart('connection-state')
      }
    }
    pc.oniceconnectionstatechange = () => {
      logPeerState('Patient PC', pc)
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        setStatus('ICE unstable. Reconnecting...')
        schedulePeerRestart('ice-state')
      }
    }
    pc.onicegatheringstatechange = () => logPeerState('Patient PC', pc)

    return pc
  }

  async function ensurePeerConnection() {
    if (pcRef.current) return pcRef.current
    pcRef.current = buildPeerConnection()
    addLocalTracksToPeer(pcRef.current)
    return pcRef.current
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

  function schedulePeerRestart(reason) {
    if (endCallRef.current || retryCountRef.current >= MAX_CALL_RETRIES) return
    retryCountRef.current += 1

    setTimeout(async () => {
      if (endCallRef.current) return

      console.log('Patient rebuilding peer connection:', reason)
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
      console.log('Patient ignoring stale signal:', payload?.sessionId)
      return
    }

    const pc = await ensurePeerConnection()

    if (payload.candidate) {
      console.log('Patient received ICE candidate')
      const candidate = new RTCIceCandidate(payload.candidate)
      if (!remoteDescriptionSetRef.current) {
        pendingIceCandidatesRef.current.push(candidate)
        return
      }

      try {
        await pc.addIceCandidate(candidate)
      } catch (error) {
        console.error('Patient error adding ICE candidate:', error)
      }
      return
    }

    const description = payload.description
    if (!description) return

    console.log('Patient received description:', description.type)
    const offerCollision = description.type === 'offer' && (isMakingOfferRef.current || pc.signalingState !== 'stable')
    ignoreOfferRef.current = !politeRef.current && offerCollision

    try {
      if (ignoreOfferRef.current) {
        console.warn('Patient ignoring offer collision from impolite role')
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
        console.log('Patient sending answer')
        emitSignalPayload({
          sessionId: sessionIdRef.current,
          role: 'patient',
          description: pc.localDescription,
        })
      } else {
        setStatus('Answer received. Establishing media...')
      }
    } catch (error) {
      console.error('Patient signal handling failed:', error)
    }
  }

  async function handleSessionState(sessionState) {
    if (!sessionState || sessionState.sessionId !== sessionIdRef.current) return

    peerConnectedRef.current = !!sessionState.therapistConnected
    console.log('Patient session-state:', sessionState)

    if (sessionState.therapistConnected && localMediaReadyRef.current) {
      setStatus('Therapist online. Preparing call...')
      if (pcRef.current?.signalingState === 'stable') {
        pendingNegotiationRef.current = true
        pcRef.current.onnegotiationneeded?.()
      }
    } else {
      setStatus('Waiting for therapist to join...')
    }
  }

  useEffect(() => {
    const socket = io("https://serien-model.onrender.com", {
  transports: ["websocket"],
})

    socketRef.current = socket
    sessionIdRef.current = getSessionId()

    socket.off('signal')
    socket.off('session-state')
    socket.off('connect')
    socket.off('disconnect')
    socket.off('connect_error')

    function cleanupConnections() {
      socket.removeAllListeners()
      socket.io.off('reconnect')
      socket.disconnect()

      if (signalingDetectTimerRef.current) {
        clearTimeout(signalingDetectTimerRef.current)
        signalingDetectTimerRef.current = null
      }

      destroyPeerConnection()

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop())
      }

      clearRemoteMedia()
    }

    async function startLocalMedia() {
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })

      localStreamRef.current = localStream

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream
      }

      setMicEnabled(localStream.getAudioTracks().every((track) => track.enabled))
      setCameraEnabled(localStream.getVideoTracks().every((track) => track.enabled))
      localMediaReadyRef.current = true

      console.log('Patient local tracks:', localStream.getTracks())

      const peerConnection = await ensurePeerConnection()
      addLocalTracksToPeer(peerConnection)
      pendingNegotiationRef.current = true

      if (peerConnectedRef.current && peerConnection.signalingState === 'stable') {
        peerConnection.onnegotiationneeded?.()
      }
    }

    socket.on('connect', () => {
      console.log('Patient socket connected:', socket.id)
      socket.emit('join-session', { sessionId: sessionIdRef.current, role: 'patient' })
      signalingModeRef.current = 'unknown'
      signalingDetectTimerRef.current = setTimeout(() => {
        if (signalingModeRef.current === 'unknown') {
          signalingModeRef.current = 'legacy'
          socket.emit('join-role', 'patient')
          console.warn('Patient falling back to legacy signaling mode')
        }
      }, SIGNAL_DETECT_TIMEOUT_MS)
      setStatus(sessionIdRef.current ? 'Connected to signaling server.' : 'Connected. Waiting for session ID...')
    })

    socket.on('disconnect', (reason) => {
      console.log('Patient socket disconnected:', reason)
    })

    socket.io.on('reconnect', (attempt) => {
      console.log('Patient socket reconnected:', attempt)
      socket.emit('join-session', { sessionId: sessionIdRef.current, role: 'patient' })
    })

    socket.on('connect_error', (error) => {
      console.error('Patient socket connect_error:', error)
    })

    socket.on('session-state', (payload) => {
      markModernSignaling()
      handleSessionState(payload)
    })
    socket.on('signal', (payload) => {
      markModernSignaling()
      handleSignal(payload)
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
        therapistConnected: !!peerStatus?.therapistConnected,
      })
    })

    socket.on('join-session-ack', (payload) => {
      markModernSignaling()
      console.log('Patient join-session-ack:', payload)
    })

    async function init() {
      try {
        setStatus('Starting camera + microphone...')
        await startLocalMedia()
      } catch (error) {
        console.error(error)
        setStatus('Could not start camera or WebRTC.')
      }
    }

    init()

    return () => {
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

  function handleEndCall() {
    endCallRef.current = true

    if (socketRef.current) {
      socketRef.current.removeAllListeners()
      socketRef.current.io.off('reconnect')
      socketRef.current.disconnect()
    }

    if (signalingDetectTimerRef.current) {
      clearTimeout(signalingDetectTimerRef.current)
      signalingDetectTimerRef.current = null
    }

    if (pcRef.current) {
      pcRef.current.ontrack = null
      pcRef.current.onicecandidate = null
      pcRef.current.onconnectionstatechange = null
      pcRef.current.oniceconnectionstatechange = null
      pcRef.current.onsignalingstatechange = null
      pcRef.current.onicegatheringstatechange = null
      pcRef.current.onnegotiationneeded = null
      pcRef.current.close()
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop())
    }

    clearRemoteMedia()

    navigate('/patient-home')
  }

  return (
    <div className="dashboard-shell call-dashboard-shell" style={{ '--sidebar-width': `${sidebarWidth}px` }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="dashboard-shell__content call-dashboard-content">
        <CallTopbar
          role="patient"
          title="Patient Session"
          subtitle="Live session"
        />

        <main className="call-dashboard-main">
          <section className="video-call-panel call-video-panel call-fade-in p-4">
            <div className="call-video-panel__header">
              <div>
                <h2 className="call-video-panel__title">Patient Session</h2>
                <p className="call-video-panel__status">{status}</p>
              </div>
              <span className={`call-connection-badge ${remoteStream ? 'is-connected' : ''}`}>
                {remoteStream ? 'Connected' : 'Waiting for therapist...'}
              </span>
            </div>

            <div ref={stageRef} className="video-call-stage call-stage call-stage--clean relative mt-3 w-full overflow-hidden">
              <video
                ref={remoteVideoRef}
                className={`call-remote-video absolute inset-0 h-full w-full object-cover ${remoteStream ? 'is-connected' : ''}`}
                autoPlay
                playsInline
              />

              {remoteStream && remotePlayBlocked ? (
                <div className="call-play-overlay">
                  <button type="button" className="call-play-overlay__button" onClick={handleResumeRemotePlayback}>
                    Tap to resume remote video
                  </button>
                </div>
              ) : null}

              {!remoteStream ? (
                <div className="call-waiting-overlay">
                  <p className="call-waiting-overlay__title">Waiting for therapist...</p>
                  <p className="call-waiting-overlay__subtitle">The call will connect automatically once your therapist starts the session.</p>
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
            />
          </section>
        </main>
      </div>
    </div>
  )
}
