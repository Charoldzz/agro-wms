import QRCode from 'qrcode'

export async function createLotQrDataUrl(lotId) {
  const configuredBaseUrl = import.meta.env.VITE_APP_BASE_URL
  const isLocalConfig =
    configuredBaseUrl?.includes('localhost') || configuredBaseUrl?.includes('127.0.0.1')
  const baseUrl =
    isLocalConfig && window.location.hostname !== 'localhost'
      ? window.location.origin
      : configuredBaseUrl || window.location.origin

  return QRCode.toDataURL(`${baseUrl}/lotes/${lotId}`, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
  })
}
