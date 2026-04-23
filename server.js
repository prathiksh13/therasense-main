const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
})

const PORT = 3000;
const FRONTEND_DIST = path.join(__dirname, 'frontend-react', 'dist');
const JOURNAL_UPLOADS_DIR = path.join(__dirname, 'journal-uploads');
const sessions = new Map();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-pro';
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const LLAMA_API_KEY = process.env.LLAMA_API_KEY;
const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = normalizeGroqModel(process.env.LLAMA_MODEL || 'llama-3.1-8b-instant');
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const FALLBACK_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'therasense-b0c8a';
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${FALLBACK_PROJECT_ID}.appspot.com`;
const USE_LOCAL_JOURNAL_UPLOADS = String(process.env.USE_LOCAL_JOURNAL_UPLOADS || 'true') !== 'false';
const MAIL_USER = process.env.EMAIL_USER || process.env.SMTP_USER || '';
const MAIL_PASS = process.env.EMAIL_PASS || process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.FROM_EMAIL || MAIL_USER;

function normalizeGroqModel(model) {
  const requestedModel = String(model || '').trim();

  if (requestedModel === 'llama3-8b-8192') {
    return 'llama-3.1-8b-instant';
  }

  return requestedModel || 'llama-3.1-8b-instant';
}

function createFirebaseAdminApp() {
  if (admin.apps.length) return admin.app();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  const localServiceAccountPath = path.join(__dirname, 'therasense-b0c8a-firebase-adminsdk-fbsvc-95932c391a.json');
  if ((!projectId || !clientEmail || !privateKey) && fs.existsSync(localServiceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(localServiceAccountPath, 'utf8'));
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: FIREBASE_STORAGE_BUCKET,
    });
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin credentials are not configured')
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });
}

let firestoreAdmin = null;
try {
  createFirebaseAdminApp();
  firestoreAdmin = admin.firestore();
} catch (error) {
  console.warn('Firebase Admin not initialized:', error.message);
}

const smtpPort = Number(process.env.SMTP_PORT || 587);
const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: smtpPort,
  secure: String(process.env.SMTP_SECURE || (smtpPort === 465 ? 'true' : 'false')) === 'true',
  auth: MAIL_USER && MAIL_PASS ? {
    user: MAIL_USER,
    pass: MAIL_PASS,
  } : undefined,
});

function oppositeRole(role) {
  return role === 'patient' ? 'therapist' : 'patient';
}

function getSessionState(sessionId) {
  if (!sessionId) return null;
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { patient: null, therapist: null });
  }
  return sessions.get(sessionId);
}

function emitSessionState(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return;

  io.to(sessionId).emit('session-state', {
    sessionId,
    patientConnected: !!state.patient,
    therapistConnected: !!state.therapist,
  });
}

function registerSessionPeer(socket, sessionId, role) {
  if (!sessionId || !role) return;

  const state = getSessionState(sessionId);
  if (!state) return;

  state[role] = socket.id;
  socket.data.role = role;
  socket.data.sessionId = sessionId;
  socket.join(sessionId);

  console.log(`${role} joined session ${sessionId} as ${socket.id}`);
  socket.emit('join-session-ack', { sessionId, role, socketId: socket.id });
  emitSessionState(sessionId);
}

function unregisterSessionPeer(socket) {
  const { sessionId, role } = socket.data || {};
  if (!sessionId || !role) return;

  const state = sessions.get(sessionId);
  if (!state) return;

  if (state[role] === socket.id) {
    state[role] = null;
  }

  emitSessionState(sessionId);

  if (!state.patient && !state.therapist) {
    sessions.delete(sessionId);
  }
}

function routeSignal(socket, payload = {}) {
  const sessionId = payload.sessionId || socket.data?.sessionId;
  const fromRole = socket.data?.role;
  if (!sessionId || !fromRole) return;

  const state = sessions.get(sessionId);
  if (!state) return;

  const targetRole = oppositeRole(fromRole);
  const targetId = state[targetRole];
  if (!targetId) return;

  io.to(targetId).emit('signal', {
    ...payload,
    sessionId,
    fromRole,
  });
}

function formatDateTime(value) {
  if (!value) return 'TBA';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return 'TBA';
  return date.toLocaleString();
}

function toMapsLink(location) {
  if (!location?.latitude || !location?.longitude) return '';
  return `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailLayout({ title, subtitle = '', intro = '', contentHtml = '', closingHtml = '' }) {
  return `
    <div style="background:#f5f8fb;padding:28px 16px;font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;">
      <table role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;border-collapse:separate;">
        <tr>
          <td style="background:linear-gradient(135deg,#1d4ed8,#0f766e);padding:22px 24px;color:#ffffff;">
            <p style="margin:0 0 4px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">TheraSense</p>
            <h1 style="margin:0;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1>
            ${subtitle ? `<p style="margin:8px 0 0 0;font-size:14px;opacity:0.95;">${escapeHtml(subtitle)}</p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            ${intro ? `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#1e293b;">${escapeHtml(intro)}</p>` : ''}
            ${contentHtml}
            ${closingHtml ? `<div style="margin-top:18px;font-size:14px;line-height:1.7;color:#334155;">${closingHtml}</div>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#64748b;">TheraSense - Supporting Your Mental Wellness Journey</p>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function buildSessionInfoBlock({ patientName, therapistName, sessionDateTime, sessionLink }) {
  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="padding:12px 14px;font-size:14px;color:#334155;border-bottom:1px solid #e2e8f0;"><strong>Patient</strong><br/>${escapeHtml(patientName)}</td>
      </tr>
      <tr>
        <td style="padding:12px 14px;font-size:14px;color:#334155;border-bottom:1px solid #e2e8f0;"><strong>Therapist</strong><br/>${escapeHtml(therapistName)}</td>
      </tr>
      <tr>
        <td style="padding:12px 14px;font-size:14px;color:#334155;border-bottom:1px solid #e2e8f0;"><strong>Date and Time</strong><br/>${escapeHtml(sessionDateTime)}</td>
      </tr>
      <tr>
        <td style="padding:12px 14px;font-size:14px;color:#334155;"><strong>Session Link</strong><br/><a href="${escapeHtml(sessionLink)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(sessionLink)}</a></td>
      </tr>
    </table>
  `;
}

async function sendEmail({ to, subject, html, text, attachments = [], maxAttempts = 3 }) {
  if (!MAIL_FROM) {
    throw new Error('FROM_EMAIL or EMAIL_USER must be configured');
  }

  if (!MAIL_USER || !MAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS (or SMTP_USER and SMTP_PASS) must be configured');
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const info = await mailTransport.sendMail({
        from: MAIL_FROM,
        to,
        subject,
        html,
        text,
        attachments,
      });
      return info;
    } catch (error) {
      lastError = error;
      console.error(`Email send failed (attempt ${attempt}/${maxAttempts}) to ${to}:`, error?.message || error);
      if (attempt < maxAttempts) {
        await wait(600 * attempt);
      }
    }
  }

  throw lastError || new Error('Unknown email send failure');
}

async function getUserProfile(uid) {
  if (!firestoreAdmin || !uid) return null;
  const snapshot = await firestoreAdmin.collection('users').doc(uid).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

async function getSession(sessionId) {
  if (!firestoreAdmin || !sessionId) return null;
  const snapshot = await firestoreAdmin.collection('sessions').doc(sessionId).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

async function sendBookingEmailBySession(sessionId, meetingLink) {
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');

  const [patient, therapist] = await Promise.all([
    getUserProfile(session.patientId),
    getUserProfile(session.therapistId),
  ]);

  if (!patient?.email || !therapist?.email) {
    throw new Error('Missing patient or therapist email address');
  }

  const sessionDateTime = formatDateTime(session.startTime);
  const link = meetingLink || `${APP_BASE_URL}/patient?sessionId=${sessionId}`;
  const subject = 'Your Therapy Session is Confirmed - TheraSense';
  const patientName = patient.name || patient.email || 'Patient';
  const therapistName = therapist.name || therapist.email || 'Therapist';

  const html = buildEmailLayout({
    title: 'Your Therapy Session Is Confirmed',
    subtitle: 'We are here to support your journey',
    intro: 'Your session has been successfully scheduled. We are here to support your journey with care and consistency.',
    contentHtml: buildSessionInfoBlock({
      patientName,
      therapistName,
      sessionDateTime,
      sessionLink: link,
    }),
    closingHtml: '<p style="margin:0;">Please join a few minutes early to settle in comfortably.</p>',
  });

  const text = `Your Therapy Session is Confirmed - TheraSense\nPatient: ${patientName}\nTherapist: ${therapistName}\nDate and Time: ${sessionDateTime}\nSession Link: ${link}\n\nYour session has been successfully scheduled. We are here to support your journey.`;

  await Promise.all([
    sendEmail({ to: patient.email, subject, html, text }),
    sendEmail({ to: therapist.email, subject, html, text }),
  ]);

  return { ok: true };
}

async function sendReminderEmailBySession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) return { skipped: true, reason: 'Session missing' };
  if (session.reminderEmailSentAt) return { skipped: true, reason: 'Already sent' };

  const now = new Date();
  const sessionTime = session.startTime?.toDate ? session.startTime.toDate() : new Date(session.startTime);
  const diffMs = sessionTime.getTime() - now.getTime();
  if (diffMs < 9 * 60 * 1000 || diffMs > 10 * 60 * 1000) {
    return { skipped: true, reason: 'Not in reminder window' };
  }

  const [patient, therapist] = await Promise.all([
    getUserProfile(session.patientId),
    getUserProfile(session.therapistId),
  ]);

  if (!patient?.email || !therapist?.email) {
    return { skipped: true, reason: 'Missing email address' };
  }

  const link = `${APP_BASE_URL}/patient?sessionId=${sessionId}`;
  const sessionDateTime = formatDateTime(session.startTime);
  const subject = 'Reminder: Your Session Starts in 10 Minutes';
  const patientName = patient.name || patient.email || 'Patient';
  const therapistName = therapist.name || therapist.email || 'Therapist';
  const html = buildEmailLayout({
    title: 'Reminder: Session Starts in 10 Minutes',
    subtitle: 'A gentle reminder from TheraSense',
    intro: 'Your session is about to begin. Take a moment to prepare and join when ready.',
    contentHtml: buildSessionInfoBlock({
      patientName,
      therapistName,
      sessionDateTime,
      sessionLink: link,
    }),
    closingHtml: '<p style="margin:0;">Wishing you a calm and meaningful session.</p>',
  });
  const text = `Reminder: Your Session Starts in 10 Minutes\nDate and Time: ${sessionDateTime}\nSession Link: ${link}\n\nYour session is about to begin. Take a moment to prepare and join when ready.`;

  await Promise.all([
    sendEmail({ to: patient.email, subject, html, text }),
    sendEmail({ to: therapist.email, subject, html, text }),
  ]);

  await firestoreAdmin.collection('sessions').doc(sessionId).update({
    reminderEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
}

async function sendEmergencyEmail(payload) {
  const { patientId, emergencyEmail, location } = payload || {};
  const patient = await getUserProfile(patientId);

  if (!patient?.name) throw new Error('Patient profile not found');

  const targetEmail = emergencyEmail || patient?.emergencyEmail;
  if (!targetEmail) throw new Error('Emergency email is required');

  const mapsLink = toMapsLink(location);
  const subject = `Emergency alert from ${patient.name}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
      <h2>Emergency alert</h2>
      <p><strong>Patient:</strong> ${patient.name}</p>
      <p><strong>Location:</strong> ${mapsLink ? `<a href="${mapsLink}">${mapsLink}</a>` : 'Location unavailable'}</p>
    </div>
  `;
  const text = `Emergency alert\nPatient: ${patient.name}\nLocation: ${mapsLink || 'Location unavailable'}`;

  await sendEmail({ to: targetEmail, subject, html, text });
  return { ok: true };
}

function getSessionLink(sessionId, reportLink) {
  if (reportLink) return reportLink;
  return `${APP_BASE_URL}/reports?sessionId=${encodeURIComponent(sessionId)}`;
}

function normalizeSummary(value, fallback = 'Your session summary is available in your TheraSense reports dashboard.') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.length > 1200 ? `${text.slice(0, 1197)}...` : text;
}

function buildOptionalPdfAttachment(reportPdfBase64, fileName) {
  if (!reportPdfBase64) return [];
  try {
    const normalized = String(reportPdfBase64).replace(/^data:application\/pdf;base64,/, '');
    return [{
      filename: fileName || 'therasense-session-report.pdf',
      content: Buffer.from(normalized, 'base64'),
      contentType: 'application/pdf',
    }];
  } catch (error) {
    console.error('Invalid PDF attachment payload. Sending email without attachment.', error?.message || error);
    return [];
  }
}

async function sendReportEmailsByPayload(payload = {}) {
  const { sessionId, reportLink, summary, patientSummary, therapistSummary, reportPdfBase64, reportPdfFileName } = payload;
  if (!sessionId) throw new Error('sessionId is required');

  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');

  const [patient, therapist] = await Promise.all([
    getUserProfile(session.patientId),
    getUserProfile(session.therapistId),
  ]);

  if (!patient?.email || !therapist?.email) {
    throw new Error('Missing patient or therapist email address');
  }

  const sessionDateTime = formatDateTime(session.startTime || session.scheduledAt);
  const link = getSessionLink(sessionId, reportLink);
  const commonSummary = normalizeSummary(summary);
  const patientSafeSummary = normalizeSummary(
    patientSummary,
    'Your session reflected meaningful engagement and progress. Please review your full report for gentle next steps.'
  );
  const therapistDetailedSummary = normalizeSummary(
    therapistSummary,
    commonSummary
  );
  const attachments = buildOptionalPdfAttachment(reportPdfBase64, reportPdfFileName);
  const subject = 'Your Session Summary is Ready';

  const patientHtml = buildEmailLayout({
    title: 'Your Session Summary Is Ready',
    subtitle: 'A supportive reflection from your TheraSense session',
    intro: 'Thank you for your openness during the session. Your progress matters, and your summary is now available.',
    contentHtml: `
      <p style="margin:0 0 10px 0;font-size:14px;color:#334155;"><strong>Session Date:</strong> ${escapeHtml(sessionDateTime)}</p>
      <p style="margin:0 0 10px 0;font-size:14px;color:#334155;"><strong>Progress Summary:</strong><br/>${escapeHtml(patientSafeSummary)}</p>
      <p style="margin:0;font-size:14px;color:#334155;"><strong>View Full Report:</strong><br/><a href="${escapeHtml(link)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(link)}</a></p>
    `,
    closingHtml: '<p style="margin:0;">Keep taking things one step at a time. Your care team is with you.</p>',
  });

  const patientText = `Your Session Summary is Ready\nSession Date: ${sessionDateTime}\nProgress Summary: ${patientSafeSummary}\nView Full Report: ${link}`;

  const therapistHtml = buildEmailLayout({
    title: 'Session Summary Ready for Clinical Review',
    subtitle: 'TheraSense report generated successfully',
    intro: 'The session report is now available with insights to support follow-up care.',
    contentHtml: `
      <p style="margin:0 0 10px 0;font-size:14px;color:#334155;"><strong>Patient:</strong> ${escapeHtml(patient.name || patient.email || 'Patient')}</p>
      <p style="margin:0 0 10px 0;font-size:14px;color:#334155;"><strong>Session Date:</strong> ${escapeHtml(sessionDateTime)}</p>
      <p style="margin:0 0 10px 0;font-size:14px;color:#334155;"><strong>Insights Summary:</strong><br/>${escapeHtml(therapistDetailedSummary)}</p>
      <p style="margin:0;font-size:14px;color:#334155;"><strong>Open Full Report:</strong><br/><a href="${escapeHtml(link)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(link)}</a></p>
    `,
  });

  const therapistText = `Your Session Summary is Ready\nPatient: ${patient.name || patient.email || 'Patient'}\nSession Date: ${sessionDateTime}\nInsights Summary: ${therapistDetailedSummary}\nOpen Full Report: ${link}`;

  const results = await Promise.allSettled([
    sendEmail({ to: patient.email, subject, html: patientHtml, text: patientText, attachments }),
    sendEmail({ to: therapist.email, subject, html: therapistHtml, text: therapistText, attachments }),
  ]);

  return {
    ok: results.some((item) => item.status === 'fulfilled'),
    patientSent: results[0]?.status === 'fulfilled',
    therapistSent: results[1]?.status === 'fulfilled',
  };
}

async function sendTherapistFollowUpEmail(payload = {}) {
  const { sessionId, therapistId, therapistMessage, nextSteps = '' } = payload;
  if (!sessionId) throw new Error('sessionId is required');
  if (!therapistMessage || !String(therapistMessage).trim()) throw new Error('therapistMessage is required');

  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');

  const resolvedTherapistId = therapistId || session.therapistId;
  const [patient, therapist] = await Promise.all([
    getUserProfile(session.patientId),
    getUserProfile(resolvedTherapistId),
  ]);

  if (!patient?.email) throw new Error('Patient email address is missing');

  const therapistName = therapist?.name || therapist?.email || session.therapistName || 'Your therapist';
  const sessionDateTime = formatDateTime(session.startTime || session.scheduledAt);
  const link = `${APP_BASE_URL}/reports?sessionId=${encodeURIComponent(sessionId)}`;

  const html = buildEmailLayout({
    title: 'A Note from Your Therapist',
    subtitle: `${escapeHtml(therapistName)} shared a follow-up reflection`,
    intro: 'Thank you for your openness during the session. Here are a few reflections to guide you forward.',
    contentHtml: `
      <p style="margin:0 0 10px 0;font-size:14px;color:#334155;"><strong>Session Date:</strong> ${escapeHtml(sessionDateTime)}</p>
      <p style="margin:0 0 10px 0;font-size:14px;color:#334155;"><strong>Therapist Message:</strong><br/>${escapeHtml(therapistMessage)}</p>
      ${nextSteps ? `<p style="margin:0 0 10px 0;font-size:14px;color:#334155;"><strong>Suggested Next Steps:</strong><br/>${escapeHtml(nextSteps)}</p>` : ''}
      <p style="margin:0;font-size:14px;color:#334155;"><strong>Session Resources:</strong><br/><a href="${escapeHtml(link)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(link)}</a></p>
    `,
    closingHtml: '<p style="margin:0;">Progress is built through consistent, compassionate steps. Keep going.</p>',
  });

  const text = `A Note from Your Therapist\nSession Date: ${sessionDateTime}\nTherapist: ${therapistName}\nMessage: ${String(therapistMessage).trim()}${nextSteps ? `\nNext Steps: ${String(nextSteps).trim()}` : ''}\nSession Resources: ${link}`;

  await sendEmail({
    to: patient.email,
    subject: 'A Note from Your Therapist',
    html,
    text,
  });

  return { ok: true };
}

app.use('/models', express.static(path.join(__dirname, 'models')));
app.use('/face-api.js', express.static(path.join(__dirname, 'face-api.js')));
app.use('/journal-uploads', express.static(JOURNAL_UPLOADS_DIR));
app.use(express.json({ limit: '20mb' }));
app.use(express.static(FRONTEND_DIST));

function sanitizeFileName(name = 'upload') {
  return String(name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function detectMediaKind(fileName = '', mimeType = '') {
  const type = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name)) return 'image';
  if (type.startsWith('video/') || /\.(mp4|mov|m4v|webm|ogg|avi)$/i.test(name)) return 'video';
  if (type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return 'audio';
  return 'file';
}

function getStorageBucketCandidates() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    admin.app()?.options?.projectId ||
    FALLBACK_PROJECT_ID;

  const configuredBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    admin.app()?.options?.storageBucket ||
    FIREBASE_STORAGE_BUCKET;

  const candidates = [
    configuredBucket,
    projectId ? `${projectId}.appspot.com` : '',
    projectId ? `${projectId}.firebasestorage.app` : '',
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function isBucketMissingError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('specified bucket does not exist') || message.includes('no such bucket');
}

app.post('/upload-journal-media', async (req, res) => {
  try {
    if (!firestoreAdmin || !admin.apps.length) {
      return res.status(500).json({ error: 'Firebase Admin is not configured on the server.' });
    }

    const { uid, fileName, mimeType, base64Data } = req.body || {};

    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: 'uid is required' });
    }

    if (!fileName || !base64Data) {
      return res.status(400).json({ error: 'fileName and base64Data are required' });
    }

    const safeName = sanitizeFileName(fileName);
    const storagePath = `journals/${uid}/${Date.now()}-${safeName}`;
    const buffer = Buffer.from(String(base64Data), 'base64');

    if (USE_LOCAL_JOURNAL_UPLOADS) {
      const localRelativePath = path.join('journals', uid, `${Date.now()}-${safeName}`);
      const localAbsolutePath = path.join(JOURNAL_UPLOADS_DIR, localRelativePath);
      await fs.promises.mkdir(path.dirname(localAbsolutePath), { recursive: true });
      await fs.promises.writeFile(localAbsolutePath, buffer);

      const localUrlPath = `/journal-uploads/${localRelativePath.replace(/\\/g, '/')}`;

      return res.json({
        kind: detectMediaKind(fileName, mimeType),
        url: localUrlPath,
        name: fileName,
        mimeType: mimeType || '',
        size: buffer.length,
        storagePath: '',
        bucket: '',
      });
    }

    const bucketCandidates = getStorageBucketCandidates();

    let bucket = null;
    let file = null;
    let lastError = null;

    for (const candidate of bucketCandidates) {
      try {
        bucket = admin.storage().bucket(candidate);
        file = bucket.file(storagePath);

        await file.save(buffer, {
          metadata: {
            contentType: mimeType || 'application/octet-stream',
            cacheControl: 'public,max-age=31536000',
          },
          resumable: false,
        });

        const [existsAfterSave] = await file.exists();
        if (!existsAfterSave) {
          console.warn(`File not found after save in bucket ${candidate}, trying fallback...`);
          bucket = null;
          file = null;
          continue;
        }

        break;
      } catch (error) {
        lastError = error;
        if (isBucketMissingError(error)) {
          console.warn(`Storage bucket not found: ${candidate}`);
          continue;
        }
        throw error;
      }
    }

    if (!bucket || !file) {
      if (!lastError || isBucketMissingError(lastError)) {
        const localRelativePath = path.join('journals', uid, `${Date.now()}-${safeName}`);
        const localAbsolutePath = path.join(JOURNAL_UPLOADS_DIR, localRelativePath);
        await fs.promises.mkdir(path.dirname(localAbsolutePath), { recursive: true });
        await fs.promises.writeFile(localAbsolutePath, buffer);

        const localUrlPath = `/journal-uploads/${localRelativePath.replace(/\\/g, '/')}`;

        return res.json({
          kind: detectMediaKind(fileName, mimeType),
          url: localUrlPath,
          name: fileName,
          mimeType: mimeType || '',
          size: buffer.length,
          storagePath: '',
          bucket: '',
        });
      }

      throw lastError || new Error('No Firebase Storage bucket candidate could be used.');
    }

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '2500-01-01',
    });

    return res.json({
      kind: detectMediaKind(fileName, mimeType),
      url,
      name: fileName,
      mimeType: mimeType || '',
      size: buffer.length,
      storagePath,
      bucket: bucket.name,
    });
  } catch (error) {
    console.error('Journal media upload error:', error);
    return res.status(500).json({ error: error.message || 'Unable to upload journal media' });
  }
});

app.get('/journal-media', async (req, res) => {
  try {
    if (!firestoreAdmin || !admin.apps.length) {
      return res.status(500).json({ error: 'Firebase Admin is not configured on the server.' });
    }

    const storagePath = String(req.query.storagePath || '').trim();
    const requestedBucket = String(req.query.bucket || '').trim();

    if (!storagePath) {
      return res.status(400).json({ error: 'storagePath is required' });
    }

    const bucketCandidates = [requestedBucket, ...getStorageBucketCandidates()].filter(Boolean);
    const uniqueBuckets = [...new Set(bucketCandidates)];

    let lastError = null;

    for (const candidate of uniqueBuckets) {
      try {
        const bucket = admin.storage().bucket(candidate);
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();

        if (!exists) continue;

        const [metadata] = await file.getMetadata().catch(() => [null]);
        if (metadata?.contentType) {
          res.setHeader('Content-Type', metadata.contentType);
        }
        res.setHeader('Cache-Control', 'public, max-age=86400');

        file
          .createReadStream()
          .on('error', (streamError) => {
            console.error('Journal media stream error:', streamError);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Unable to stream media file' });
            }
          })
          .pipe(res);

        return;
      } catch (error) {
        lastError = error;
        if (isBucketMissingError(error)) {
          console.warn(`Storage bucket not found while reading media: ${candidate}`);
          continue;
        }
        throw error;
      }
    }

    if (lastError && !isBucketMissingError(lastError)) {
      throw lastError;
    }

    return res.status(404).json({ error: 'Media file not found' });
  } catch (error) {
    console.error('Journal media read error:', error);
    return res.status(500).json({ error: error.message || 'Unable to read journal media' });
  }
});

function getSystemPrompt(role, context = {}) {
  const base =
    'You are a helpful AI assistant for a teleconsultation platform. Keep responses concise, clinically appropriate, and supportive. Never claim to be a doctor. Do not give emergency instructions unless the user is in immediate danger.';

  if (role === 'therapist') {
    const summary = context.sessionSummary ? `Session summary: ${context.sessionSummary}.` : '';
    const timelineHint = Array.isArray(context.emotionTimeline) && context.emotionTimeline.length > 0
      ? 'Emotion timeline data is available. Use it to identify trends, concerns, and suggestions.'
      : 'No emotion timeline is available.';

    return `${base} You are assisting a therapist. Respond in an analytical, structured way with insights, possible concerns, and practical suggestions. ${summary} ${timelineHint}`;
  }

  return `${base} You are assisting a patient. Respond with empathy, emotional awareness, supportive language, and gentle suggestions. Encourage reflection and brief coping steps.`;
}

function getLlamaSystemPrompt(emotion) {
  const basePrompt = `You are a calm, supportive mental health assistant inside a teletherapy platform.

* Do not give medical diagnosis
* Be empathetic and short (2-4 lines)
* Help users express emotions
* Suggest calming techniques when needed

You are an AI assistant supporting a live therapy session.
You may reference emotions detected during the call.
Keep responses short, calm, and human-like.`;

  const emotionText = String(emotion || '').trim().slice(0, 80);
  if (!emotionText) return basePrompt;
  return `${basePrompt}\n\nUser current emotion: ${emotionText}. Respond accordingly.`;
}

async function generateGroqReply({ message, emotion }) {
  if (!LLAMA_API_KEY) {
    const error = new Error('LLAMA_API_KEY is not configured on the server');
    error.statusCode = 500;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.6,
        max_tokens: 180,
        messages: [
          { role: 'system', content: getLlamaSystemPrompt(emotion) },
          { role: 'user', content: String(message || '').trim().slice(0, 2000) },
        ],
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Groq API request timed out');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiMessage = payload?.error?.message || `Groq API failed with status ${response.status}`;
    const error = new Error(apiMessage);
    error.statusCode = response.status;
    throw error;
  }

  const reply = payload?.choices?.[0]?.message?.content;
  if (!reply || !String(reply).trim()) {
    throw new Error('No response returned from Groq LLaMA model');
  }

  return String(reply).trim();
}

function extractJsonArray(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return [];

  try {
    const direct = JSON.parse(raw);
    if (Array.isArray(direct)) return direct;
    if (Array.isArray(direct?.questions)) return direct.questions;
  } catch {
    // Continue to bracket extraction fallback.
  }

  const firstBracket = raw.indexOf('[');
  const lastBracket = raw.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    return [];
  }

  const sliced = raw.slice(firstBracket, lastBracket + 1);
  try {
    const parsed = JSON.parse(sliced);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeMcqQuestions(questions = [], count = 5) {
  const safeCount = Math.max(5, Math.min(10, Number(count) || 5));

  const cleaned = questions
    .map((question) => {
      const questionText = String(question?.questionText || question?.question || '').trim();
      const options = Array.isArray(question?.options)
        ? question.options.map((option) => String(option || '').trim()).filter(Boolean)
        : [];
      const correctAnswer = String(question?.correctAnswer || '').trim();
      const explanation = String(question?.explanation || '').trim();

      if (!questionText || options.length < 4) {
        return null;
      }

      return {
        questionText,
        options: options.slice(0, 4),
        ...(correctAnswer ? { correctAnswer } : {}),
        explanation: explanation || 'This response supports emotional awareness and a practical coping step.',
      };
    })
    .filter(Boolean)
    .slice(0, safeCount);

  return cleaned;
}

async function generateAssignmentQuestionsWithLlama({ count = 5 }) {
  if (!LLAMA_API_KEY) {
    const error = new Error('LLAMA_API_KEY is not configured on the server');
    error.statusCode = 500;
    throw error;
  }

  const safeCount = Math.max(5, Math.min(10, Number(count) || 5));
  const prompt = `You are a therapist asking questions directly to a patient.

---

🚫 STRICT RULES:

- DO NOT generate questions about therapists
- DO NOT generate theoretical or knowledge-based questions
- DO NOT use phrases like:
  "What is..."
  "How can a therapist..."
  "What should a therapist..."

If any question violates this, regenerate everything.

---

✅ REQUIREMENTS:

- Ask questions using "you"
- Focus on patient's feelings, thoughts, and behavior
- Keep language simple and human
- Make it feel like a real therapy conversation

---

🎯 TASK:

Convert therapy concepts into patient self-reflection questions.

---

📌 FORMAT:

Return ONLY JSON:

[
  {
    "question": "When you feel overwhelmed, what do you usually do?",
    "options": [
      "Try to ignore it",
      "Talk to someone about it",
      "Keep it to myself",
      "Distract myself"
    ],
    "correctAnswer": "Talk to someone about it"
  }
]

---

📌 TOPICS:

- Emotional awareness
- Stress triggers
- Coping behavior
- Self-reflection

---

📌 TONE:

- Warm
- Supportive
- Non-judgmental

---

Generate 5 questions.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let response;
  try {
    response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.5,
        max_tokens: 1200,
        messages: [
          {
            role: 'system',
            content: 'You generate supportive therapist-to-patient reflection MCQs for teleconsultation assignments.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Groq API request timed out');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = payload?.error?.message || `Groq API failed with status ${response.status}`;
    const error = new Error(apiMessage);
    error.statusCode = response.status;
    throw error;
  }

  const rawText = payload?.choices?.[0]?.message?.content || '';
  const parsedArray = extractJsonArray(rawText);
  const questions = sanitizeMcqQuestions(parsedArray, safeCount);

  if (!questions.length) {
    const error = new Error('LLAMA response did not include valid MCQ JSON');
    error.statusCode = 502;
    throw error;
  }

  return questions;
}

function isBookingIntent(message = '') {
  return /\b(book|schedule|reserve|set up|make|create)\b/i.test(message) &&
    /\b(meeting|appointment|session|therapy|call|consultation)\b/i.test(message);
}

function getNextWeekdayDate(dayName) {
  const days = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const target = days[String(dayName || '').toLowerCase()];
  if (target === undefined) return null;

  const date = new Date();
  const current = date.getDay();
  const offset = (target - current + 7) % 7 || 7;
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseBookingDate(message = '') {
  const text = String(message || '').toLowerCase();
  const date = new Date();

  if (/\btoday\b/.test(text)) {
    date.setHours(0, 0, 0, 0);
    return date;
  }

  if (/\btomorrow\b/.test(text)) {
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  const isoMatch = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const parsed = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const slashMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (slashMatch) {
    const year = slashMatch[3] ? Number(slashMatch[3]) : date.getFullYear();
    const parsed = new Date(year, Number(slashMatch[2]) - 1, Number(slashMatch[1]));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const weekdayMatch = text.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) return getNextWeekdayDate(weekdayMatch[2]);

  return null;
}

function parseBookingTime(message = '') {
  const text = String(message || '').toLowerCase();
  const amPmMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (amPmMatch) {
    let hours = Number(amPmMatch[1]);
    const minutes = Number(amPmMatch[2] || 0);
    if (hours < 1 || hours > 12 || minutes > 59) return null;
    if (amPmMatch[3] === 'pm' && hours !== 12) hours += 12;
    if (amPmMatch[3] === 'am' && hours === 12) hours = 0;
    return { hours, minutes };
  }

  const atMatch = text.match(/\b(?:at|by|around)\s+(\d{1,2}):(\d{2})\b/);
  if (atMatch) {
    const hours = Number(atMatch[1]);
    const minutes = Number(atMatch[2]);
    if (hours > 23 || minutes > 59) return null;
    return { hours, minutes };
  }

  return null;
}

function combineDateAndTime(date, time) {
  if (!date || !time) return null;
  const combined = new Date(date);
  combined.setHours(time.hours, time.minutes, 0, 0);
  return Number.isNaN(combined.getTime()) ? null : combined;
}

function formatSessionDateTime(date) {
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function verifyChatUser(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return admin.auth().verifyIdToken(match[1]);
}

async function chooseTherapistForBooking(patientId, message = '') {
  const therapistSnapshot = await firestoreAdmin
    .collection('users')
    .where('role', '==', 'therapist')
    .get();

  const therapists = therapistSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  if (!therapists.length) return null;

  const text = String(message || '').toLowerCase();
  const requested = therapists.find((therapist) => {
    const name = String(therapist.name || therapist.displayName || therapist.email || '').toLowerCase();
    const specialization = String(therapist.specialization || '').toLowerCase();
    return (name && text.includes(name)) || (specialization && text.includes(specialization));
  });
  if (requested) return requested;

  const recentSessionSnapshot = await firestoreAdmin
    .collection('sessions')
    .where('patientId', '==', patientId)
    .limit(10)
    .get();

  const recentTherapistIds = recentSessionSnapshot.docs
    .map((entry) => entry.data()?.therapistId)
    .filter(Boolean);
  const recentTherapist = therapists.find((therapist) => recentTherapistIds.includes(therapist.id));

  return recentTherapist || therapists[0];
}

async function bookSessionFromChat({ req, message }) {
  if (!isBookingIntent(message)) return null;

  if (!firestoreAdmin) {
    return { reply: 'I can help with booking, but appointments are temporarily unavailable. Please try again shortly.' };
  }

  const authUser = await verifyChatUser(req).catch(() => null);
  if (!authUser?.uid) {
    return { reply: 'Please sign in first, then tell me the date and time you want for your appointment.' };
  }

  const date = parseBookingDate(message);
  const time = parseBookingTime(message);
  const missing = [];
  if (!date) missing.push('date');
  if (!time) missing.push('time');

  if (missing.length) {
    return {
      reply: `I can book that for you. Please share the ${missing.join(' and ')} for the session.`,
    };
  }

  const startTime = combineDateAndTime(date, time);
  if (!startTime || startTime.getTime() <= Date.now()) {
    return { reply: 'Please choose a future date and time for the appointment.' };
  }

  const [patientProfile, therapist] = await Promise.all([
    getUserProfile(authUser.uid),
    chooseTherapistForBooking(authUser.uid, message),
  ]);

  if (!therapist?.id) {
    return { reply: 'I could not find an available therapist to book with right now.' };
  }

  const scheduledAt = admin.firestore.Timestamp.fromDate(startTime);
  const roomId = `${authUser.uid}_${therapist.id}_${Date.now()}`;
  const sessionRef = await firestoreAdmin.collection('sessions').add({
    patientId: authUser.uid,
    patientName: patientProfile?.name || authUser.name || authUser.email || '',
    therapistId: therapist.id,
    therapistName: therapist.name || therapist.displayName || therapist.email || '',
    status: 'pending',
    roomId,
    scheduledAt,
    startTime: scheduledAt,
    createdAt: admin.firestore.Timestamp.now(),
    bookedBy: 'chatbot',
  });

  await firestoreAdmin
    .collection('therapistPatients')
    .doc(`${therapist.id}_${authUser.uid}`)
    .set({
      therapistId: therapist.id,
      patientId: authUser.uid,
      createdAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

  const meetingLink = `${APP_BASE_URL}/patient?sessionId=${sessionRef.id}`;
  sendBookingEmailBySession(sessionRef.id, meetingLink).catch((error) => {
    console.error('Failed to send chatbot booking email:', error?.message || error);
  });

  return {
    reply: `Booked. Your session with ${therapist.name || therapist.email || 'your therapist'} is set for ${formatSessionDateTime(startTime)}.`,
    booking: {
      id: sessionRef.id,
      therapistId: therapist.id,
      therapistName: therapist.name || therapist.email || '',
      startTime: startTime.toISOString(),
      status: 'pending',
    },
  };
}

async function chatHandler(req, res) {
  try {
    const { message, emotion = '' } = req.body || {};
    const trimmedMessage = String(message || '').trim();

    if (!trimmedMessage || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    if (trimmedMessage.length > 2000) {
      return res.status(413).json({ error: 'message is too long' });
    }

    const bookingResult = await bookSessionFromChat({ req, message: trimmedMessage });
    if (bookingResult) {
      return res.json(bookingResult);
    }

    const reply = await generateGroqReply({ message: trimmedMessage, emotion });

    return res.json({ reply: String(reply).trim() });
  } catch (error) {
    const status = Number(error?.statusCode || 500) === 401 ? 500 : Number(error?.statusCode || 500);
    console.error('Chat API error:', error?.message || error);
    return res.status(status).json({ error: 'Unable to generate AI response' });
  }
}

app.post('/api/chat', chatHandler);
app.post('/chat', chatHandler);

app.post('/api/assignments/generate', async (req, res) => {
  try {
    const requestedCount = Number(req.body?.count || 5);
    const questions = await generateAssignmentQuestionsWithLlama({ count: requestedCount });
    return res.json({ questions });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    console.error('Assignment generation API error:', error?.message || error);
    return res.status(status).json({ error: error?.message || 'Unable to generate assignment questions' });
  }
});

app.post('/send-booking-email', async (req, res) => {
  try {
    const { sessionId, meetingLink } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    const result = await sendBookingEmailBySession(sessionId, meetingLink);
    return res.json(result);
  } catch (error) {
    console.error('Booking email error:', error);
    return res.status(500).json({ error: error.message || 'Unable to send booking email' });
  }
});

app.post('/send-reminder-email', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    const result = await sendReminderEmailBySession(sessionId);
    return res.json(result);
  } catch (error) {
    console.error('Reminder email error:', error);
    return res.status(500).json({ error: error.message || 'Unable to send reminder email' });
  }
});

app.post('/send-report-email', async (req, res) => {
  try {
    const result = await sendReportEmailsByPayload(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error('Report email error:', error);
    return res.status(500).json({ error: error.message || 'Unable to send report email' });
  }
});

app.post('/send-therapist-note', async (req, res) => {
  try {
    const result = await sendTherapistFollowUpEmail(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error('Therapist follow-up email error:', error);
    return res.status(500).json({ error: error.message || 'Unable to send therapist follow-up email' });
  }
});

app.post('/send-emergency-email', async (req, res) => {
  try {
    const result = await sendEmergencyEmail(req.body || {});
    return res.json(result);
  } catch (error) {
    console.error('Emergency email error:', error);
    return res.status(500).json({ error: error.message || 'Unable to send emergency email' });
  }
});

cron.schedule('* * * * *', async () => {
  if (!firestoreAdmin) return;

  try {
    const snapshot = await firestoreAdmin.collection('sessions').get();
    const now = Date.now();
    for (const sessionDoc of snapshot.docs) {
      const data = sessionDoc.data();
      if (data.reminderEmailSentAt) continue;

      const startTime = data?.startTime?.toDate ? data.startTime.toDate() : new Date(data.startTime);
      const diffMs = startTime.getTime() - now;
      if (diffMs >= 9 * 60 * 1000 && diffMs <= 10 * 60 * 1000) {
        await sendReminderEmailBySession(sessionDoc.id);
      }
    }
  } catch (error) {
    console.error('Reminder cron error:', error);
  }
});

app.get(/.*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join-session', ({ sessionId, role }) => {
    if (!sessionId || (role !== 'patient' && role !== 'therapist')) return;
    unregisterSessionPeer(socket);
    registerSessionPeer(socket, sessionId, role);
  });

  socket.on('signal', (payload) => {
    routeSignal(socket, payload);
  });

  socket.on('emotion_update', (payload) => {
    routeSignal(socket, payload);
  });

  ['offer', 'answer', 'ice-candidate'].forEach((eventName) => {
    socket.on(eventName, (payload) => {
      routeSignal(socket, {
        sessionId: payload?.sessionId,
        [eventName === 'ice-candidate' ? 'candidate' : 'description']:
          eventName === 'ice-candidate' ? payload : payload,
      });
    });
  });

  socket.on('disconnect', () => {
    unregisterSessionPeer(socket);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Serving React app and Socket.IO from a single port (3000).');
});


