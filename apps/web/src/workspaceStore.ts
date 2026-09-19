import { del, get, set } from 'idb-keyval'
import { parseWorkspaceFile, type WorkspaceFile } from '@holo/core'

/**
 * 작업 공간을 브라우저에 담아 둔다.
 *
 * 설계 문서 6장이 작업 공간 상태를 IndexedDB에 두기로 한 자리다. localStorage는
 * 문자열만 담고 용량도 작아서, 나중에 Arrow 테이블·GLB 원본이 같이 들어오면 못 버틴다.
 * 지금 넣는 것은 작은 JSON 하나지만 자리를 미리 맞춰 둔다.
 *
 * 저장은 실패해도 화면이 멈추면 안 된다. 시크릿 창이나 저장 공간이 막힌 브라우저에서는
 * IndexedDB 호출이 그대로 예외를 던진다. 그래서 여기서 삼키고 결과만 돌려준다.
 */
const KEY = 'holo:workspace'

export async function loadWorkspace(): Promise<WorkspaceFile | null> {
  let stored: unknown
  try {
    stored = await get(KEY)
  } catch {
    return null
  }
  if (stored === undefined) return null

  const parsed = parseWorkspaceFile(stored)
  if (!parsed.ok) {
    // 읽을 수 없는 것을 남겨 두면 새로 고칠 때마다 같은 실패를 반복한다.
    void clearWorkspace()
    return null
  }
  return parsed.file
}

export async function saveWorkspace(file: WorkspaceFile): Promise<boolean> {
  try {
    await set(KEY, file)
    return true
  } catch {
    return false
  }
}

export async function clearWorkspace(): Promise<void> {
  try {
    // 키 하나만 지운다. 이 저장소에는 나중에 Arrow 테이블과 모델 원본도 들어온다.
    await del(KEY)
  } catch {
    // 지우지 못해도 할 수 있는 일이 없다.
  }
}
