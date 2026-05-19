import QRCode from 'qrcode'

export function createLotUrl(lotId) {
  return `${window.location.origin}/#/lotes/${lotId}`
}

export async function createLotQrDataUrl(lotId) {
  return QRCode.toDataURL(createLotUrl(lotId), {
    width: 640,
    margin: 4,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  })
}
