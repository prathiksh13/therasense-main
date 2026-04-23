import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

function applyPdfSafeStyles(element, clonedDocument) {
  if (!element || !clonedDocument) return

  const safeTextColor = '#ffffff'
  const safeMutedColor = '#cbd5e1'
  const safeBorderColor = '#334155'
  const safePanelColor = '#111827'
  const safeInputColor = '#1e293b'
  const safeAccentColor = '#2563eb'

  const resetEffects = (node) => {
    node.style.animation = 'none'
    node.style.transition = 'none'
    node.style.filter = 'none'
    node.style.backdropFilter = 'none'
    node.style.boxShadow = 'none'
    node.style.textShadow = 'none'
    node.style.backgroundImage = 'none'
    node.style.backgroundClip = 'border-box'
    node.style.color = safeTextColor
    node.style.fontFamily = 'Arial, sans-serif'
  }

  const styleContainer = (node) => {
    node.style.backgroundColor = safePanelColor
    node.style.color = safeTextColor
    node.style.border = `1px solid ${safeBorderColor}`
    node.style.borderRadius = '16px'
    node.style.padding = '16px'
    node.style.boxShadow = 'none'
    node.style.backdropFilter = 'none'
  }

  const styleText = (node, color = safeMutedColor) => {
    node.style.color = color
    node.style.fontFamily = 'Arial, sans-serif'
  }

  const styleControl = (node) => {
    node.style.backgroundColor = safeInputColor
    node.style.color = safeTextColor
    node.style.border = `1px solid ${safeBorderColor}`
    node.style.borderRadius = '10px'
    node.style.fontFamily = 'Arial, sans-serif'
    node.style.boxShadow = 'none'
    node.style.backdropFilter = 'none'
  }

  const queue = [element]

  while (queue.length > 0) {
    const node = queue.shift()
    if (!(node instanceof HTMLElement)) continue

    node.removeAttribute('class')
    resetEffects(node)

    const tag = node.tagName.toLowerCase()

    if (node === element) {
      node.style.width = '800px'
      node.style.margin = '0'
      node.style.padding = '24px'
      node.style.backgroundColor = '#0f172a'
      node.style.lineHeight = '1.6'
      node.style.boxSizing = 'border-box'
    }

    if (tag === 'section' || tag === 'article' || tag === 'header') {
      styleContainer(node)
      if (tag === 'header') {
        node.style.marginBottom = '16px'
      }
    }

    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
      styleText(node, safeTextColor)
      node.style.margin = '0'
      node.style.fontWeight = '700'
    }

    if (tag === 'p' || tag === 'span' || tag === 'label' || tag === 'small' || tag === 'li') {
      styleText(node, safeMutedColor)
    }

    if (tag === 'ul') {
      node.style.paddingLeft = '20px'
      node.style.margin = '0'
    }

    if (tag === 'button') {
      node.style.backgroundColor = safeAccentColor
      node.style.color = '#ffffff'
      node.style.border = `1px solid ${safeAccentColor}`
      node.style.borderRadius = '10px'
      node.style.fontFamily = 'Arial, sans-serif'
      node.style.boxShadow = 'none'
      node.style.backdropFilter = 'none'
    }

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      styleControl(node)
      node.style.padding = '10px 12px'
    }

    if (tag === 'canvas') {
      node.style.backgroundColor = '#0f172a'
      node.style.border = `1px solid ${safeBorderColor}`
      node.style.borderRadius = '12px'
    }

    if (tag === 'div') {
      const containsCanvas = node.querySelector('canvas') !== null
      if (containsCanvas) {
        node.style.backgroundColor = '#0f172a'
        node.style.border = `1px solid ${safeBorderColor}`
        node.style.borderRadius = '12px'
        node.style.padding = '12px'
      }
    }

    Array.from(node.children).forEach((child) => queue.push(child))
  }

  clonedDocument.querySelectorAll('style, link[rel="stylesheet"]').forEach((sheet) => sheet.remove())
}

/**
 * Generate and download session report as PDF
 * @param {string} fileName - Name of the PDF file (e.g., 'session-report')
 * @param {string} elementId - DOM element id for the report container
 * @returns {Promise<void>}
 */
export async function generateReportPDF(fileName = 'session-report', elementId = 'report-section') {
  try {
    const reportElement = document.getElementById(elementId)
    if (!reportElement) {
      console.error('Report section not found')
      alert('Report section not found. Cannot generate PDF.')
      return
    }

    await new Promise((resolve) => requestAnimationFrame(() => resolve()))

    const canvas = await html2canvas(reportElement, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#0f172a',
      imageTimeout: 0,
      onclone: (clonedDocument) => {
        const clonedElement = clonedDocument.getElementById(elementId)
        if (clonedElement) {
          applyPdfSafeStyles(clonedElement, clonedDocument)
        }
      },
    })

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 10
    const contentWidth = pageWidth - 2 * margin

    const imgAspectRatio = canvas.width / canvas.height
    const imgWidth = contentWidth
    const imgHeight = imgWidth / imgAspectRatio

    const imageData = canvas.toDataURL('image/png')
    let yPosition = margin
    let remainingHeight = imgHeight

    while (remainingHeight > 0) {
      const availableHeight = pageHeight - 2 * margin - (yPosition - margin)

      if (availableHeight >= remainingHeight) {
        pdf.addImage(imageData, 'PNG', margin, yPosition, imgWidth, remainingHeight)
        remainingHeight = 0
      } else {
        pdf.addImage(imageData, 'PNG', margin, yPosition, imgWidth, availableHeight)
        remainingHeight -= availableHeight
        yPosition = margin

        if (remainingHeight > 0) {
          pdf.addPage()
        }
      }
    }

    pdf.save(`${fileName}.pdf`)
  } catch (error) {
    console.error('PDF generation error:', error)
    alert('Failed to generate PDF. Check console for details.')
  }
}

export function generateReportPdfFromData(report = {}, fileName = 'report') {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const createdAt = report?.createdAt?.toDate ? report.createdAt.toDate() : null
  const reportDate = createdAt ? createdAt.toLocaleString() : 'Timestamp unavailable'
  const emotionData = report?.emotionData || {}
  const timeline = report?.timeline || emotionData?.timeline || []

  pdf.setFontSize(18)
  pdf.text('Your Progress Summary', 14, 20)

  pdf.setFontSize(11)
  pdf.text(`Patient Name: ${report.patientName || 'N/A'}`, 14, 32)
  pdf.text(`Therapist Name: ${report.therapistName || 'N/A'}`, 14, 39)
  pdf.text(`Date: ${reportDate}`, 14, 46)

  const summaryLines = pdf.splitTextToSize(`Progress Summary: ${report.summary || report.emotionSummary || 'N/A'}`, 180)
  pdf.text(summaryLines, 14, 58)

  let y = 58 + summaryLines.length * 6 + 12

  if (report?.therapistNotes) {
    pdf.setFontSize(13);
    pdf.text('Message from your therapist:', 14, y)
    y += 8;
    pdf.setFontSize(11);
    const noteLines = pdf.splitTextToSize(report.therapistNotes, 180);
    pdf.text(noteLines, 14, y);
    y += noteLines.length * 6 + 12;
  }

  pdf.setFontSize(13);
  pdf.text('Session Journey:', 14, y)
  y += 8
  
  pdf.setFontSize(11);
  pdf.text('During this session, you showed steady progress in exploring and navigating your feelings.', 14, y);
  y += 12;

  pdf.setFontSize(13);
  pdf.text('What to try this week:', 14, y);
  y += 8;
  pdf.setFontSize(11);
  pdf.text('- Practice deep breathing when feeling overwhelmed.', 14, y);
  y += 6;
  pdf.text('- Try daily journaling to reflect on your progress.', 14, y);
  y += 6;
  pdf.text('- Use positive affirmations to center yourself.', 14, y);

  pdf.save(`${fileName}.pdf`)
}
