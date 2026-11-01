// Plain-text extraction from a .docx. Pure (no electron import, relative
// imports carry .ts) so the selftests load it under node type stripping.
// The agent's Read tool cannot open .docx, so uploaded Word résumés are handed
// to agents as this text instead. Body text only: headers, footers, comments
// and text boxes are not résumé facts often enough to justify a full parser.
import AdmZip from 'adm-zip'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10))
    return ENTITIES[body] ?? whole
  })
}

/** Text of word/document.xml, one line per paragraph. Throws when the buffer
 *  is not a Word document. */
export function docxToText(buffer: Buffer): string {
  const zip = new AdmZip(buffer)
  const entry = zip.getEntry('word/document.xml')
  if (!entry) throw new Error('not a Word document (no word/document.xml)')
  const xml = entry.getData().toString('utf-8')
  const text = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
