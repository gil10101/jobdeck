// Curated, data/tech-centric role taxonomy for the target-roles picker, plus
// the fixed option lists for the work-authorization and language-proficiency
// dropdowns. Custom roles are always addable, so this list is suggestions, not
// a closed set.

export interface RoleCategory {
  category: string
  roles: string[]
}

export const ROLE_TAXONOMY: RoleCategory[] = [
  {
    category: 'Data & Analytics',
    roles: [
      'Data Analyst',
      'BI Analyst',
      'Business Analyst',
      'Business/BI Analyst',
      'Reporting Analyst',
      'Data Scientist',
      'Analytics Engineer',
      'Quantitative Analyst',
      'Marketing Analyst',
      'Financial Analyst'
    ]
  },
  {
    category: 'Data Engineering',
    roles: [
      'Data Engineer',
      'Junior Data Engineer',
      'ETL Developer',
      'Data Warehouse Engineer',
      'Big Data Engineer',
      'Cloud Data Engineer',
      'Data Platform Engineer'
    ]
  },
  {
    category: 'ML & AI',
    roles: [
      'Machine Learning Engineer',
      'MLOps Engineer',
      'AI Engineer',
      'Data Science Intern',
      'Applied Scientist'
    ]
  },
  {
    category: 'BI & Visualization',
    roles: [
      'Power BI Developer',
      'Tableau Developer',
      'BI Engineer',
      'BI Developer'
    ]
  },
  {
    category: 'Database & Platform',
    roles: [
      'Database Administrator',
      'Junior Database Administrator',
      'Database Developer',
      'Data Architect',
      'SQL Developer'
    ]
  },
  {
    category: 'Software Engineering',
    roles: [
      'Software Engineer',
      'Backend Engineer',
      'Full Stack Engineer',
      'Python Engineer',
      'Data Infrastructure Engineer'
    ]
  },
  {
    category: 'Product & Operations',
    roles: ['Product Analyst', 'Operations Analyst', 'Data Operations Analyst', 'Program Analyst']
  }
]

export interface Option {
  value: string
  label: string
}

export const WORK_AUTH_OPTIONS: Option[] = [
  { value: 'U.S. citizen', label: 'U.S. citizen' },
  { value: 'U.S. permanent resident (Green Card)', label: 'U.S. permanent resident (Green Card)' },
  {
    value: 'Authorized to work in the U.S. — no sponsorship required',
    label: 'Authorized — no sponsorship needed'
  },
  {
    value: 'Will require visa sponsorship (e.g. H-1B)',
    label: 'Will require sponsorship (e.g. H-1B)'
  },
  { value: 'F-1 student (OPT/CPT eligible)', label: 'F-1 student (OPT/CPT)' }
]

export const PROFICIENCY_OPTIONS: Option[] = [
  { value: 'Native', label: 'Native' },
  { value: 'Fluent', label: 'Fluent' },
  { value: 'Professional working', label: 'Professional working' },
  { value: 'Conversational', label: 'Conversational' },
  { value: 'Basic', label: 'Basic' }
]

export const WORK_MODELS: { value: 'onsite' | 'hybrid' | 'remote'; label: string }[] = [
  { value: 'onsite', label: 'Onsite' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' }
]

export const EMPLOYMENT_TYPES: { value: 'full-time' | 'part-time' | 'contract' | 'internship'; label: string }[] = [
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' }
]
