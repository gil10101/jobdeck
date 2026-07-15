import type { AssistantApproval } from '@shared/types'

export default function ApprovalCard({
  approval,
  onDecide
}: {
  approval: AssistantApproval
  onDecide: (d: 'allow' | 'deny') => void
}): JSX.Element {
  return (
    <div className="rounded-lg border border-edge bg-panel2 p-3">
      <div className="text-xs font-semibold text-gray-200">
        Approval required · {approval.tool}
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[10px] leading-relaxed text-gray-400">
        {approval.preview}
      </pre>
      <div className="mt-2 flex justify-end gap-2">
        <button className="btn" onClick={() => onDecide('deny')}>
          Deny
        </button>
        <button className="btn btn-green" onClick={() => onDecide('allow')}>
          Approve
        </button>
      </div>
    </div>
  )
}
