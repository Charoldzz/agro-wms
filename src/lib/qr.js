import QRCode from 'qrcode'

export async function createLotQrDataUrl(lotId) {
  return QRCode.toDataURL(`${window.location.origin}/#/lotes/${lotId}`, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
  })
}
