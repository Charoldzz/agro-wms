import QRCode from 'qrcode'

export function createLotUrl(qrToken) {
  return `${window.location.origin}/#/qr/${qrToken}`
}

export async function createLotQrDataUrl(qrToken) {
  return QRCode.toDataURL(createLotUrl(qrToken), {
    width: 640,
    margin: 4,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  })
}
