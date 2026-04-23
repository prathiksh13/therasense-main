import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/chat': 'http://localhost:3000',
      '/send-booking-email': 'http://localhost:3000',
      '/send-reminder-email': 'http://localhost:3000',
      '/send-report-email': 'http://localhost:3000',
      '/send-therapist-note': 'http://localhost:3000',
      '/send-emergency-email': 'http://localhost:3000',
      '/upload-journal-media': 'http://localhost:3000',
      '/face-api.js': 'http://localhost:3000',
      '/models': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
