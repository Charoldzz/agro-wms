export function vibrateSuccess() {
  navigator.vibrate?.([50, 40, 50])
}

export function vibrateWarning() {
  navigator.vibrate?.([90])
}

export function vibrateError() {
  navigator.vibrate?.([120, 50, 120])
}
