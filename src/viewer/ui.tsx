import { CATS } from './metrics'

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-gray-700">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
      {hint && <p className="text-xs text-gray-700">{hint}</p>}
    </div>
  )
}

/** 등급 맞대기 표. 대각선(같은 등급)은 초록으로 칠한다 */
export function ConfusionTable({ matrix, rowLabel, colLabel }: { matrix: number[][]; rowLabel: string; colLabel: string }) {
  return (
    <div>
      <p className="mb-1 font-semibold text-gray-900">
        등급 맞대기 (세로 {rowLabel}, 가로 {colLabel})
      </p>
      <table className="border-collapse text-center">
        <thead>
          <tr>
            <th className="border border-gray-300 bg-gray-50 px-3 py-1.5" />
            {CATS.map((c) => (
              <th key={c} className="border border-gray-300 bg-gray-50 px-3 py-1.5">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CATS.map((r, i) => (
            <tr key={r}>
              <th className="border border-gray-300 bg-gray-50 px-3 py-1.5">{r}</th>
              {CATS.map((c, j) => (
                <td key={c} className={`border border-gray-300 px-3 py-1.5 ${i === j ? 'bg-green-50 font-semibold' : ''}`}>
                  {matrix[i][j] || ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-gray-700">X = 판단 불가</p>
    </div>
  )
}
