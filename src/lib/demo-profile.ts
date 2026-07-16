// Demo profile — Neeraj Singh
// Hardcoded for development/testing until the full profile editor + storage is built.
// The background service worker falls back to this when chrome.storage has no profile.
//
// TO REPLACE: Once the Options page profile editor is live, delete this file
// and remove the fallback in src/lib/storage.ts

import type { UserProfile } from '@/types/profile'

export const DEMO_PROFILE: UserProfile = {
  // ── Personal Info ──────────────────────────────────────────────────────────
  firstName: 'Neeraj',
  middleName: '',
  lastName: 'Singh',
  preferredFirstName: 'Neeraj',
  preferredLastName: 'Singh',
  email: 'neerajlovecyber@gmail.com',
  phone: '7988815263',
  phoneCountryCode: '+91',
  location: 'Delhi NCR, India',
  address: 'Delhi NCR, India',
  linkedinUrl: 'https://linkedin.com/in/neerajlovecyber',
  githubUrl: undefined,
  portfolioUrl: undefined,
  website: undefined,

  // ── Professional Summary ───────────────────────────────────────────────────
  headline:
    'DevOps Engineer — CI/CD Automation • Cloud Operations • Containers & IaC',
  summary: `DevOps Engineer with 2+ years of combined professional and internship experience building reliable cloud, automation, and release workflows across AWS, Linux, CI/CD, and containerized environments. Strong in GitHub Actions, Docker, Kubernetes, Terraform, Ansible, scripting, centralized logging, monitoring, and deployment validation. Experienced in adding security-aware checks and operational visibility to delivery pipelines.`,

  // ── Work Experience ────────────────────────────────────────────────────────
  workExperience: [
    {
      id: 'exp-1',
      company: 'xIoTz Private Limited',
      title: 'DevOps Engineer',
      location: 'Remote, Delhi NCR (Company base: Bengaluru)',
      startDate: '2024-11',
      endDate: null, // current
      description:
        'Co-designed and operated a cyber assurance platform on AWS EC2. Built reproducible Windows/Linux deployment workflows and automated operational response workflows with Wazuh Active Response. Developed asset discovery, baseline checks, evidence collection, and remediation tracking workflows.',
      achievements: [
        'Improved operational visibility for 10 cloud workloads through provisioning, logging, monitoring, and deployment controls',
        'Reduced setup drift through scripted health checks, configuration baselines, and repeatable environment controls',
        'Reduced manual remediation steps and improved consistency across distributed workloads via Wazuh Active Response automation',
        'Documented findings and partnered with engineers on operational reporting and remediation tracking',
      ],
    },
    {
      id: 'exp-2',
      company: 'Frugal Testing',
      title: 'DevOps & CI/CD Intern',
      location: 'Hyderabad, India',
      startDate: '2023-01',
      endDate: '2024-01',
      description:
        'Implemented GitHub Actions pipelines, containerized test environments with Docker, and automated distributed execution on Kubernetes. Programmed web/API validation with Java, Selenium, and Postman.',
      achievements: [
        'Reduced manual deployment overhead by 30% through GitHub Actions CI/CD pipeline automation with repeatable checks and release validation',
        'Improved validation consistency by 30% by containerizing test environments with Docker and automating distributed execution on Kubernetes',
        'Shipped Slack alerts for faster failure visibility, collaborating via Jira',
      ],
    },
  ],

  // ── Education ──────────────────────────────────────────────────────────────
  education: [
    {
      id: 'edu-1',
      institution: 'Lovely Professional University',
      degree: 'Bachelor of Technology',
      field: 'Computer Science and Engineering',
      startDate: '2020-08',
      endDate: '2024-10',
      gpa: '8.29',
    },
  ],

  // ── Skills ─────────────────────────────────────────────────────────────────
  skills: [
    { name: 'AWS', level: 'advanced' },
    { name: 'Linux Administration', level: 'advanced' },
    { name: 'CI/CD Pipelines', level: 'advanced' },
    { name: 'GitHub Actions', level: 'advanced' },
    { name: 'Docker', level: 'advanced' },
    { name: 'Kubernetes', level: 'intermediate' },
    { name: 'Terraform', level: 'intermediate' },
    { name: 'Ansible', level: 'intermediate' },
    { name: 'Infrastructure Automation', level: 'advanced' },
    { name: 'ELK / OpenSearch', level: 'intermediate' },
    { name: 'Centralized Logging', level: 'intermediate' },
    { name: 'Monitoring', level: 'intermediate' },
    { name: 'Python Scripting', level: 'intermediate' },
    { name: 'Shell Scripting', level: 'advanced' },
    { name: 'Postman', level: 'intermediate' },
    { name: 'Wazuh', level: 'intermediate' },
    { name: 'Release Validation', level: 'advanced' },
    { name: 'Deployment Workflows', level: 'advanced' },
  ],

  // ── Resume plain text (used as AI context) ─────────────────────────────────
  resumeText: `Neeraj Singh — DevOps Engineer
Location: Delhi NCR, India | Phone: +91 7988815263 | Email: neerajlovecyber@gmail.com
LinkedIn: linkedin.com/in/neerajlovecyber

SUMMARY
DevOps Engineer with 2+ years of combined professional and internship experience building reliable cloud, automation, and release workflows across AWS, Linux, CI/CD, and containerized environments. Strong in GitHub Actions, Docker, Kubernetes, Terraform, Ansible, scripting, centralized logging, monitoring, and deployment validation. Experienced in adding security-aware checks and operational visibility to delivery pipelines.

SKILLS
AWS • Linux Administration • CI/CD Pipelines • GitHub Actions • Docker • Kubernetes • Terraform • Ansible
Infrastructure Automation • Release Validation • Deployment Workflows • Configuration Baselines • Health Checks • Environment Provisioning
ELK/OpenSearch • Centralized Logging • Monitoring • Python Scripting • Shell Scripting • Postman • Jira
Communication • Teamwork • Ownership • Documentation • Stakeholder Updates • Operational Follow-Through

EXPERIENCE

DevOps Engineer | xIoTz Private Limited | Remote, Delhi NCR | Nov 2024 – Present
• Cloud Operations: Co-designed and operated a cyber assurance platform on AWS EC2, improving operational visibility for 10 cloud workloads through provisioning, logging, monitoring, and deployment controls.
• Infrastructure Automation: Built reproducible Windows/Linux deployment workflows, reducing setup drift through scripted health checks, configuration baselines, and repeatable environment controls.
• Automation & Reliability: Automated operational response workflows with Wazuh Active Response, reducing manual remediation steps and improving consistency across distributed workloads.
• Operational Reporting: Built workflows for asset discovery, baseline checks, evidence collection, and remediation tracking; documented findings and partnered with engineers.

DevOps & CI/CD Intern | Frugal Testing | Hyderabad, India | 2023 – 2024
• CI/CD Pipeline Automation: Implemented GitHub Actions pipelines with repeatable checks and release validation, reducing manual deployment overhead by 30%.
• Containerization & Orchestration: Containerized test environments with Docker and automated distributed execution on Kubernetes, enabling parallel test runs and improving validation consistency by 30%.
• Release Visibility: Programmed web/API validation with Java, Selenium, and Postman; collaborated in Jira and shipped Slack alerts for faster failure visibility.

PROJECTS
• Cyber Assurance Platform — AWS-based operations plane for centralized logging, workload telemetry, retention, event queues, and release visibility using Docker, Valkey/Redis, and ELK/OpenSearch.
• WatchTower Security Scanner — Automated domain audit tool collecting DNS, TLS, HTTP headers, WAF, open-port, WHOIS, blocklist, vendor, and threat-signal data with exportable findings.
• Security Audit360 — Baseline & audit console for 40+ digital asset signals including DNS, domains, public IPs, and SSL/TLS certificates; generated baseline reports for operations review.

CERTIFICATIONS
• Certified Ethical Hacker (CEH) — EC-Council
• Jr. Penetration Tester (eJPT) — eLearnSecurity
• AWS & DevOps Fundamentals — KodeKloud

EDUCATION
Bachelor of Technology in Computer Science and Engineering | CGPA 8.29
Lovely Professional University, Punjab | Aug 2020 – Oct 2024`,

  // ── Job preferences ────────────────────────────────────────────────────────
  targetRoles: [
    'DevOps Engineer',
    'Platform Engineer',
    'Site Reliability Engineer',
    'Cloud Engineer',
    'Infrastructure Engineer',
  ],
  targetLocations: ['Delhi NCR', 'Remote', 'Bengaluru', 'Hyderabad'],
  desiredSalary: undefined,
  remotePreference: 'remote',
  noticePeriod: '0', // days — LinkedIn expects a number (0 = immediate)

  // ── Cached answers (pre-fill common questions) ─────────────────────────────
  cachedAnswers: {
    'years of experience': '2',
    'are you authorized to work': 'Yes',
    'require visa sponsorship': 'No',
    'highest education': "Bachelor's Degree",
    'willing to relocate': 'Yes',
    'notice period': '0',
    'expected salary': 'Open to discussion',
    'how did you hear about us': 'Job board',
  },
}
