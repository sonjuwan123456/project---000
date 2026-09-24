/**
 * 썸네일 — 설계 문서 6장 "공통 로더 기능"의 마지막 항목.
 *
 * 문서가 적은 것은 "3D 모델, 이미지, PDF 첫 페이지의 작은 미리보기를 자산 목록에
 * 표시"다. 이미지와 PDF는 M4에 오고 자산 목록은 M5에 오므로, M1에서 세울 것은 **자리**다
 * — 자산 종류마다 미리보기를 어떻게 만들지 한 곳에 적어 두고, 오늘 만들 수 있는
 * 하나(3D 모델)를 채워 넣는다. M4가 형식을 더할 때 고칠 곳이 `MAKERS` 한 줄이 되도록.
 *
 * **왜 데이터층이 아니라 여기인가.** 모델의 미리보기는 실제로 한 번 그려 봐야 나온다.
 * 그리는 일은 시각화층 몫이고, 데이터층은 WebGL을 몰라야 한다(의존 방향 규칙).
 *
 * **왜 Blob이 아니라 데이터 URL인가.** Blob 주소는 거둬 주지 않으면 탭이 닫힐 때까지
 * 남는다. 썸네일은 자산을 따라다니며 여러 화면에 얹히는 값이라, 누가 거둘지가 흐려지는
 * 순간 새기 시작한다. 96×96 PNG는 몇 KB라 글자로 들고 다니는 편이 낫다.
 */

import {
  Box3,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { useEffect, useRef, useState } from 'react'
import type { Asset, AssetKind, LoadedModel } from '@holo/data'

import { disposeScene } from './gltfParse'
import { parseModel } from './modelParse'

/** 한 변의 픽셀 수. 목록에 얹힐 크기이고, 화면 배율은 CSS가 맡는다. */
export const THUMBNAIL_SIZE = 96

/** 카메라가 쓰는 값들. 시험이 같은 값을 보고 가늠할 수 있게 내놓는다. */
export const THUMBNAIL_CAMERA = { fieldOfView: 30, margin: 1.25 } as const

/** 시야각이 좁을수록 원근이 약해 물건의 모양이 또렷하다. 목록에 얹힐 그림에 맞다. */
const FIELD_OF_VIEW = THUMBNAIL_CAMERA.fieldOfView
/** 꽉 채우지 않고 조금 띄운다. 가장자리가 잘리면 무엇인지 알아보기 어렵다. */
const MARGIN = THUMBNAIL_CAMERA.margin

/** 정면이 아니라 조금 위 비스듬히. 납작한 물건도 두께가 보인다. */
const EYE = new Vector3(1, 0.55, 1)

/**
 * 장면을 카메라 안에 담는다.
 *
 * 무대에 앉히는 `fitToStage`와 다른 계산이다. 무대는 바닥이 격자에 붙어야 하고 크기가
 * 다른 모델끼리 견줄 수 있어야 하지만, 썸네일은 그럴 것이 없고 **한 장에 꽉 차 보이는
 * 것**만 중요하다. 가장 긴 변이 아니라 감싸는 공의 반지름으로 재는 까닭도 그것이다.
 * 긴 변으로 재면 비스듬히 놓인 물건의 모서리가 잘린다.
 */
export function frameBox(camera: PerspectiveCamera, box: Box3): void {
  const sphere = box.getBoundingSphere(new Sphere())
  const radius = sphere.radius > 0 ? sphere.radius : 1
  const distance = (radius * MARGIN) / Math.sin((FIELD_OF_VIEW * Math.PI) / 360)

  camera.position.copy(sphere.center).addScaledVector(EYE.clone().normalize(), distance)
  camera.near = Math.max(distance - radius * 2, distance / 100)
  camera.far = distance + radius * 4
  camera.lookAt(sphere.center)
  camera.updateProjectionMatrix()
}

/**
 * 3D 모델을 한 장 그려서 데이터 URL로 낸다. 그리지 못하면 null.
 *
 * **`preserveDrawingBuffer`가 필요하다.** 없으면 그린 뒤에 `toDataURL`이 빈 그림을
 * 낸다. 브라우저가 프레임을 넘기며 버퍼를 비우기 때문인데, 오류가 나지 않고 **하얀
 * 사각형**이 나와서 코드를 의심하게 만든다.
 *
 * 만든 것은 모두 그 자리에서 돌려준다. WebGL 맥락은 탭마다 열여섯 개쯤으로 막혀
 * 있어서, 썸네일을 몇 번 만들고 놓아 주지 않으면 정작 무대가 맥락을 못 얻는다.
 */
async function renderModel(model: LoadedModel): Promise<string | null> {
  if (typeof document === 'undefined') return null

  const parsed = parseModel(model.format, model.bytes, model.resources)
  let root
  try {
    root = await parsed.scene
  } catch {
    parsed.release()
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = THUMBNAIL_SIZE
  canvas.height = THUMBNAIL_SIZE

  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    })
  } catch {
    parsed.release()
    disposeScene(root)
    return null
  }

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = environment.texture
  scene.add(root)

  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 1000)
  const box = new Box3().setFromObject(root)
  if (!box.isEmpty()) frameBox(camera, box)

  let url: string | null
  try {
    renderer.setPixelRatio(1)
    renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false)
    renderer.render(scene, camera)
    url = canvas.toDataURL('image/png')
  } catch {
    url = null
  } finally {
    scene.remove(root)
    disposeScene(root)
    environment.dispose()
    pmrem.dispose()
    renderer.dispose()
    // 맥락은 `dispose`만으로는 놓이지 않는다. 명시로 놓아 주어야 다음 사람이 받는다.
    renderer.forceContextLoss()
    parsed.release()
  }
  return url
}

/**
 * 종류마다 미리보기를 어떻게 만들지.
 *
 * 표와 글자는 없다. 문서가 적은 셋(3D 모델, 이미지, PDF)에 들지 않고, 억지로 넣으면
 * 글자를 줄여 그린 회색 얼룩이 되어 목록에서 아무것도 구별해 주지 못한다. 그런 자리는
 * 종류를 나타내는 기호가 낫고, 그것은 목록이 정할 일이다.
 */
const MAKERS: Partial<Record<AssetKind, (asset: Asset) => Promise<string | null>>> = {
  model: async (asset) => (asset.kind === 'model' ? await renderModel(asset.model) : null),
}

/** 자산의 미리보기. 만들 수 없는 종류이거나 그리지 못하면 null. */
export async function thumbnailOf(asset: Asset): Promise<string | null> {
  const make = MAKERS[asset.kind]
  return make === undefined ? null : await make(asset)
}

/** 이 종류에 미리보기가 있는지. 목록이 자리를 잡을 때 그려 보지 않고 묻는다. */
export function hasThumbnail(kind: AssetKind): boolean {
  return MAKERS[kind] !== undefined
}

/**
 * 자산의 미리보기를 그려서 들고 있는다. 아직 없거나 만들 수 없으면 null.
 *
 * **자산 id로 다시 그릴 때를 가린다.** 자산 객체가 아니라 id를 보는 까닭은, 부르는
 * 쪽이 `{ kind: 'model', ... }`를 그 자리에서 지어 넘기는 일이 흔하기 때문이다.
 * 객체로 가리면 그릴 때마다 새 객체라 끝없이 다시 그리게 된다. id는 같은 파일이면
 * 같은 값이라(`assetIdOfFile`) 다시 그릴 일과 아닐 일을 정확히 가른다.
 */
export function useThumbnail(asset: Asset | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const key = asset === null ? null : asset.assetId
  const latest = useRef(asset)
  latest.current = asset

  useEffect(() => {
    if (key === null) {
      setUrl(null)
      return
    }
    let alive = true
    setUrl(null)
    const asset = latest.current
    if (asset === null) return
    void thumbnailOf(asset).then((made) => {
      if (alive) setUrl(made)
    })
    return () => {
      alive = false
    }
  }, [key])

  return url
}
