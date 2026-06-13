import { useEffect } from 'react'
import { useStore, type Toast } from '../lib/store'

// 指令送出回饋:右下角堆疊的 toast,每則約 3.5s 自動消失。
export function Toaster() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast)
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), 3500)
    return () => clearTimeout(id)
  }, [toast.id, dismiss])
  return (
    <div className={`toast ${toast.kind}`} onClick={() => dismiss(toast.id)}>
      {toast.text}
    </div>
  )
}
