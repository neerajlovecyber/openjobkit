import * as pdfjs from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'

// Set the worker source for PDFJS
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker

/**
 * Extracts plain text from a PDF file's ArrayBuffer.
 */
export async function extractTextFromPdf(
  arrayBuffer: ArrayBuffer,
): Promise<string> {
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise
  let text = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => item.str || '')
      .join(' ')
    text += pageText + '\n'
  }

  return text.trim()
}
