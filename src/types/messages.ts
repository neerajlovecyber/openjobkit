// Type-safe extension message protocol
// All messages between content scripts, background, popup, and side panel

import type { JobListing, JobApplication } from './job'

// ────────────────────────────────────────────────────────────────────────────
// Message Types (discriminated union)
// ────────────────────────────────────────────────────────────────────────────

/** Content script → Background: job form was detected on the current page */
export interface DetectJobMessage {
  type: 'DETECT_JOB'
  payload: {
    job: Omit<JobListing, 'id' | 'detectedAt'>
    tabId: number
  }
}

/** Content script → Background: request AI-generated answers for a job */
export interface FillJobMessage {
  type: 'FILL_JOB'
  payload: {
    applicationId: string
    fields: Array<FormField>
  }
}

/** Background → Content script: send filled answers back */
export interface FillAnswersMessage {
  type: 'FILL_ANSWERS'
  payload: {
    applicationId: string
    answers: Record<string, string> // fieldId → value
    coverLetter?: string
  }
}

/** Content script → Background: user clicked Apply */
export interface SubmitJobMessage {
  type: 'SUBMIT_JOB'
  payload: {
    applicationId: string
  }
}

/** Any → Any: update application status */
export interface UpdateStatusMessage {
  type: 'UPDATE_STATUS'
  payload: {
    applicationId: string
    status: JobApplication['status']
    error?: string
  }
}

/** Popup / Side panel → Background: get all tracked applications */
export interface GetApplicationsMessage {
  type: 'GET_APPLICATIONS'
}

/** Background → Popup / Side panel: respond with all applications */
export interface ApplicationsResponseMessage {
  type: 'APPLICATIONS_RESPONSE'
  payload: {
    applications: Array<JobApplication>
  }
}

/** Any → Any: generic error */
export interface ErrorMessage {
  type: 'ERROR'
  payload: {
    message: string
    context?: string
  }
}

// Union of all possible messages
export type ExtensionMessage =
  | DetectJobMessage
  | FillJobMessage
  | FillAnswersMessage
  | SubmitJobMessage
  | UpdateStatusMessage
  | GetApplicationsMessage
  | ApplicationsResponseMessage
  | ErrorMessage

// ────────────────────────────────────────────────────────────────────────────
// Form Field Types (used by autofill engine)
// ────────────────────────────────────────────────────────────────────────────

export type FieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'file'
  | 'date'

export interface FormField {
  id: string // Unique ID for this field (generated)
  label: string // Human-readable label extracted from DOM
  type: FieldType
  required: boolean
  placeholder?: string
  options?: Array<string> // For select/radio
  selector: string // CSS selector to the DOM element
  context?: string // Extra context (e.g. surrounding section label)
}
