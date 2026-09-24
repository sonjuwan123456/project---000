import type { StoredCamera } from './workspaceFile'

/**
 * 카메라를 밖에서 움직이는 손잡이.
 *
 * 3D 뷰는 `@react-three/drei`의 컨트롤을 쥐고 있고, 손 제스처는 `@holo/input`이 읽는다.
 * 층 구조상 둘은 서로를 import 할 수 없으므로(설계 문서 3장), 사이에 둘 형태만 여기에 둔다.
 *
 * 각도는 라디안이고, 목표점을 중심으로 한 구면 좌표의 변화량이다. 부호는 three.js의
 * OrbitControls와 같게 맞췄다. 화면을 오른쪽으로 끄는 것이 음수 방위각, 아래로 끄는 것이
 * 음수 고도각이다.
 */
export type CameraDrive = {
  /** 목표점을 중심으로 돌린다. */
  rotate(azimuth: number, polar: number): void
  /** 목표점에 다가가거나 멀어진다. 양수가 가까워지는 쪽. */
  dolly(delta: number): void
  /** 조작이 끝났다고 알린다. 이때 지금 카메라가 작업 공간에 저장된다. */
  rest(): void
  /**
   * 저장해 둔 자리로 날아간다(카메라 북마크). 도착하면 `rest`와 같이 알린다.
   * 날아가는 중에 손이나 다른 비행이 들어오면 그 자리에서 멈추고 새 조작을 따른다.
   */
  flyTo(camera: StoredCamera): void
}
