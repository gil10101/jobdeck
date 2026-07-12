import type { ProfileFile, Story } from '@shared/profile'

/**
 * ProfileRenderer — pure functions from profile.json to the markdown fragments
 * injected into agent prompts. This replaces the v1 agents' "read CLAUDE.md"
 * step, so the rendering must carry the same guidance quality: inclusion rules,
 * verbatim phrases, and framing constraints become explicit imperatives.
 */

function section(title: string, body: string): string {
  return body.trim() ? `### ${title}\n${body.trim()}\n` : ''
}

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n')
}

function dateRange(start: string, end: string): string {
  return `${start || '?'} -- ${end || 'present'}`
}

export function renderProfileMd(p: ProfileFile): string {
  const out: string[] = ['## CANDIDATE PROFILE (authoritative — never contradict or embellish)']

  const id = p.identity
  out.push(
    section(
      'Identity',
      [
        `- Name: ${id.fullName}`,
        `- Location: ${id.location}`,
        `- Phone: ${id.phone}`,
        `- Email: ${id.email}`,
        id.linkedin && `- LinkedIn: ${id.linkedin}`,
        id.github && `- GitHub: ${id.github}`,
        id.website && `- Website: ${id.website}`,
        id.languages.length &&
          `- Languages: ${id.languages.map((l) => `${l.name} (${l.proficiency})`).join(', ')}`,
        `- Work authorization: ${id.workAuth}`,
        id.status && `- Current status: ${id.status}`
      ]
        .filter(Boolean)
        .join('\n')
    )
  )

  out.push(
    section(
      'Education',
      p.education
        .map((e) => {
          const lines = [
            `- **${e.degree}** — ${e.institution}${e.location ? `, ${e.location}` : ''} (${dateRange(e.startDate, e.endDate)})${e.gpa ? ` · GPA ${e.gpa}` : ''}`
          ]
          if (e.thesis) lines.push(`  - Thesis: ${e.thesis}`)
          if (e.coursework.length) lines.push(`  - Coursework: ${e.coursework.join(', ')}`)
          if (e.notes) lines.push(`  - Note: ${e.notes}`)
          return lines.join('\n')
        })
        .join('\n')
    )
  )

  out.push(
    section(
      'Professional Experience',
      p.experience
        .map((e) => {
          const lines = [
            `- **${e.title}** — ${e.company}${e.location ? `, ${e.location}` : ''} (${dateRange(e.startDate, e.endDate)})`
          ]
          for (const b of e.bullets) lines.push(`  - ${b}`)
          if (e.technologies.length) lines.push(`  - Technologies: ${e.technologies.join(', ')}`)
          if (e.inclusionRule) lines.push(`  - INCLUSION RULE: ${e.inclusionRule}`)
          if (e.framingNotes) lines.push(`  - FRAMING: ${e.framingNotes}`)
          return lines.join('\n')
        })
        .join('\n')
    )
  )

  out.push(
    section(
      'Independent Projects',
      p.projects
        .map((pr) => {
          const lines = [`- **${pr.name}**${pr.url ? ` (${pr.url})` : ''} — ${pr.oneLiner}`]
          for (const b of pr.bullets) lines.push(`  - ${b}`)
          if (pr.technologies.length) lines.push(`  - Technologies: ${pr.technologies.join(', ')}`)
          if (pr.mustKeepPhrases.length) {
            lines.push(
              `  - VERBATIM REQUIRED: when describing this project, use these exact phrases: ${pr.mustKeepPhrases.map((s) => `"${s}"`).join('; ')}`
            )
          }
          if (pr.framingNotes) lines.push(`  - FRAMING: ${pr.framingNotes}`)
          if (pr.inclusionRule) lines.push(`  - INCLUSION RULE: ${pr.inclusionRule}`)
          return lines.join('\n')
        })
        .join('\n')
    )
  )

  out.push(
    section(
      'Skills',
      p.skills.map((c) => `- **${c.category}:** ${c.items.join(', ')}`).join('\n')
    )
  )

  out.push(
    section(
      'Certifications',
      p.certifications
        .map(
          (c) =>
            `- ${c.title} (${c.issuer}${c.date ? `, ${c.date}` : ''})${c.inclusionRule ? ` — INCLUSION RULE: ${c.inclusionRule}` : ''}`
        )
        .join('\n')
    )
  )

  if (p.publications.length) {
    out.push(section('Publications', bullets(p.publications.map((x) => x.citation))))
  }
  if (p.awards.length) {
    out.push(
      section(
        'Awards',
        bullets(p.awards.map((a) => `${a.title} (${a.issuer}${a.date ? `, ${a.date}` : ''})`))
      )
    )
  }

  const b = p.behavioral
  const behavioralBody = [
    b.traits.length && `- Traits: ${b.traits.join('; ')}`,
    b.strengths.length && `- Strengths: ${b.strengths.join('; ')}`,
    b.growthAreas.length &&
      `- Growth areas (be honest about these, never paper over them): ${b.growthAreas.join('; ')}`,
    b.thrivesIn.length && `- Thrives in: ${b.thrivesIn.join('; ')}`
  ]
    .filter(Boolean)
    .join('\n')
  out.push(section('Behavioral Profile', behavioralBody))

  const n = p.narrative
  const narrativeBody = [
    n.whatExcites.length && `- What excites the candidate: ${n.whatExcites.join('; ')}`,
    n.targetSectors.length && `- Target sectors: ${n.targetSectors.join('; ')}`,
    n.dealBreakers.length && `- Deal-breakers: ${n.dealBreakers.join('; ')}`
  ]
    .filter(Boolean)
    .join('\n')
  out.push(section('Preferences', narrativeBody))

  return out.filter(Boolean).join('\n')
}

export function renderSearchCriteriaMd(p: ProfileFile): string {
  const s = p.searchConfig
  const roles = [...s.targetRoles].sort((a, b) => a.priority - b.priority)
  const lines = [
    '## SEARCH CRITERIA (hard filters — apply ruthlessly)',
    roles.length &&
      `- Target roles (priority order): ${roles.map((r) => `${r.priority}. ${r.title}`).join(' · ')}`,
    `- Posted within the last ${s.timing.maxAgeDays} days ONLY.`,
    s.salary.ftPostedMaxUsd !== null &&
      `- Full-time roles: posted salary max must be ≤ $${s.salary.ftPostedMaxUsd.toLocaleString()}${s.salary.internshipsExempt ? ' (internships/part-time exempt from any ceiling)' : ''}.`,
    s.minCompanySize !== null && `- Company size ${s.minCompanySize}+ employees only.`,
    s.teamPreference && `- Team preference: ${s.teamPreference}`,
    s.locationTiers.length &&
      `- Locations: ${s.locationTiers.map((t) => `${t.tier}: ${t.description}`).join(' | ')}`,
    s.workModels.length < 3 && `- Work models allowed: ${s.workModels.join(', ')}`,
    s.excludeCompanies.length && `- NEVER suggest these companies: ${s.excludeCompanies.join(', ')}`,
    ...s.extraHardFilters.map((f) => `- ${f}`),
    p.narrative.dealBreakers.length &&
      `- Deal-breakers (skip matching roles): ${p.narrative.dealBreakers.join('; ')}`
  ]
  return lines.filter(Boolean).join('\n')
}

export function renderTailoringRulesMd(p: ProfileFile): string {
  const t = p.tailoring
  const lines = ['## TAILORING RULES']
  if (t.roleProfiles.length) {
    lines.push('Pick the FIRST role profile whose match terms appear in the posting title:')
    for (const r of t.roleProfiles) {
      lines.push(`- **${r.label}** (matches: ${r.match.join(', ')})`)
      if (r.skillCategoryOrder.length) {
        lines.push(`  - Skills section order: ${r.skillCategoryOrder.join(' → ')}`)
      }
      if (r.projectPriority.length) {
        lines.push(`  - Project priority: ${r.projectPriority.join(' → ')} (drop the least relevant to fit 1 page)`)
      }
      if (r.profileStatement) lines.push(`  - Profile statement: ${r.profileStatement}`)
      if (r.notes) lines.push(`  - ${r.notes}`)
    }
  } else {
    lines.push(
      '- No role profiles configured: order skills/projects by relevance to the posting, most relevant first.'
    )
  }
  lines.push('', '### HARD RULES (non-negotiable)')
  for (const rule of t.hardRules) lines.push(`- ${rule}`)
  return lines.join('\n')
}

export function renderAnswersInfoMd(p: ProfileFile): string {
  const id = p.identity
  const s = p.searchConfig
  const edu = p.education[0]
  return [
    '## SAVED APPLICATION INFO (use exactly these values in application_answers.md)',
    `- Full name: ${id.fullName}`,
    `- Email: ${id.email}`,
    `- Phone: ${id.phone}`,
    `- Location: ${id.location}`,
    id.linkedin && `- LinkedIn: ${id.linkedin}`,
    id.github && `- GitHub: ${id.github}`,
    id.website && `- Website: ${id.website}`,
    `- Work authorization: ${id.workAuth}`,
    s.salary.desired && `- Desired salary: ${s.salary.desired}`,
    s.availability && `- Availability: ${s.availability}`,
    edu &&
      `- Highest/most recent degree: ${edu.degree}, ${edu.institution} (${edu.endDate || 'in progress'})`
  ]
    .filter(Boolean)
    .join('\n')
}

export function renderStoriesMd(p: ProfileFile, use: Story['use'][number]): string {
  const stories = p.narrative.stories.filter((s) => s.use.includes(use))
  if (!stories.length) {
    return '(no saved stories — derive concrete, truthful stories from the experience/projects above)'
  }
  return stories.map((s) => `- **${s.title}**: ${s.text}`).join('\n')
}

export function renderLogisticsMd(p: ProfileFile): string {
  const s = p.searchConfig
  return [
    `- Desired salary answer: ${s.salary.desired || '(not set)'}`,
    `- Availability: ${s.availability || '(not set)'}`,
    `- Work authorization: ${p.identity.workAuth}`
  ].join('\n')
}

export function renderExtraRulesMd(p: ProfileFile): string {
  if (!p.customRules.length) return '(none)'
  return p.customRules.map((r) => `- ${r}`).join('\n')
}

export function renderCoverLetterStyleMd(p: ProfileFile): string {
  const d = p.documents
  return [
    `- Length: ${d.coverLetterWordRange[0]}-${d.coverLetterWordRange[1]} words, 3-4 short paragraphs, exactly 1 page.`,
    `- Register: ${d.coverLetterRegister}`,
    '- Build it on two concrete stories (see stories below) plus one differentiator, mirroring a couple of the posting\'s own phrases.'
  ].join('\n')
}
