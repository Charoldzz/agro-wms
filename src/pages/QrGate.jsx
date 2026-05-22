import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { QrCode } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function QrGate() {
  const { token } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    async function resolveQr() {
      const { data, error: rpcError } = await supabase.rpc('resolve_lot_qr', {
        p_token: token,
      })

      let lotId = Array.isArray(data) ? data[0]?.lot_id : data
      if (rpcError || !lotId) {
        const { data: lotByToken } = await supabase
          .from('lots')
          .select('id')
          .eq('qr_token', token)
          .maybeSingle()
        lotId = lotByToken?.id || ''
      }

      if (!lotId) {
        setError('No autorizado o QR invalido.')
        return
      }

      sessionStorage.setItem(`scanned-lot-${lotId}`, '1')
      if (location.state?.movementMode) {
        sessionStorage.setItem(`lot-mode-${lotId}`, location.state.movementMode)
      } else {
        sessionStorage.removeItem(`lot-mode-${lotId}`)
      }

      if (location.state?.returnTo) {
        const separator = location.state.returnTo.includes('?') ? '&' : '?'
        navigate(`${location.state.returnTo}${separator}lot=${lotId}`, {
          replace: true,
          state: { scanned: true, movementMode: location.state.movementMode || '' },
        })
        return
      }

      navigate(`/lotes/${lotId}`, {
        replace: true,
        state: { scanned: true, movementMode: location.state?.movementMode || '' },
      })
    }

    resolveQr()
  }, [location.state, navigate, token])

  if (!token) return <Navigate to="/" replace />

  return (
    <div className="panel text-center">
      <QrCode className="mx-auto text-campo-700" size={42} />
      <h2 className="mt-3 text-xl font-bold text-slate-950">Validando QR</h2>
      <p className="mt-2 text-sm font-semibold text-slate-500">
        {error || 'Revisando permisos de acceso...'}
      </p>
    </div>
  )
}
