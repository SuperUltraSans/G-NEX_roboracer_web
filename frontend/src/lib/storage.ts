// 사생활 보호 모드나 차단된 저장소에서는 localStorage 에 접근하는 것만으로 예외가 난다.
// 저장소 없이도 화면은 동작해야 하므로 접근부터 try 안에서 한다.

type Kind = 'local' | 'session'

function storage(kind: Kind): Storage {
  return kind === 'local' ? window.localStorage : window.sessionStorage
}

export function readStorage(kind: Kind, key: string): string | null {
  try {
    return storage(kind).getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(kind: Kind, key: string, value: string | null): void {
  try {
    if (value === null) storage(kind).removeItem(key)
    else storage(kind).setItem(key, value)
  } catch {
    // 저장하지 못해도 동작에는 지장이 없다
  }
}
