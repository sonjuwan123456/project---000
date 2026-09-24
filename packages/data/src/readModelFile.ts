/**
 * 파일 하나를 3D 모델 자산으로 읽는다 — M1 핵심 형식의 나머지 절반.
 *
 * 표와 달리 여기서는 내용을 우리 모양으로 바꾸지 않는다. 원본 바이트를 그대로 들고
 * 있다가 뷰에 넘기고, 데이터층은 "무엇이 들었는지"와 "무엇이 모자란지"만 읽는다.
 * three의 `GLTFLoader`가 이미 규격을 다 아는데 그 일을 여기서 한 번 더 할 이유가 없다.
 *
 * 대신 여기서만 할 수 있는 일이 있다. 파일을 무대에 올리기 전에 바깥 파일을 가리키는
 * glTF와 해제기가 필요한 압축을 가려내는 것이다. 그리다 실패하면 사람은 빈 화면을
 * 보지만, 미리 세어 두면 무엇을 어떻게 내보내야 하는지 말해 줄 수 있다.
 *
 * M4에서 OBJ와 STL이 같은 입구로 들어왔다. 세는 일만 형식마다 다르고(`wavefront`,
 * `stl`), 크기 검사와 바깥 파일 찾기와 안내는 한 길로 간다.
 */

import { assetIdOfFile, type FileIdentity } from './assetId'
import { readGlb, readGltfJson, summarizeGltf } from './gltf'
import type { LoadNotice } from './loadTable'
import { resolveResources, type FileBundle } from './fileBundle'
import { MODEL_FORMAT_LABELS, type ModelFormat, type ModelSummary } from './modelSummary'
import { checkFileSize, sizeNotices } from './sizeGuard'
import { summarizeStl } from './stl'
import { UnsupportedFileError } from './unsupported'
import { summarizeObj, texturesOfMtl } from './wavefront'

export type LoadedModel = {
  /** 표와 같은 규칙으로 만든 id. 같은 파일을 다시 열면 같은 값이다. */
  readonly assetId: string
  readonly name: string
  readonly format: ModelFormat
  /**
   * 원본 바이트. 뷰가 three로 다시 파싱한다.
   *
   * 파싱한 장면이 아니라 바이트를 들고 있는 까닭은 층 때문만이 아니다. three의 장면
   * 객체는 GPU 자원을 쥐고 있어서 작업 공간 상태에 넣어 둘 것이 못 된다. 바이트는
   * 그냥 값이라 워커로 보낼 수도, 나중에 IndexedDB에 넣어 둘 수도 있다.
   */
  readonly bytes: ArrayBuffer
  readonly summary: ModelSummary
  /**
   * 묶음에서 찾아낸 바깥 파일. uri가 적힌 그대로 키다.
   *
   * GLB이거나 폴더 없이 파일 하나만 연 경우에는 비어 있다. 뷰가 three에게 상대
   * 경로를 물어 올 때 이 표로 답한다.
   */
  readonly resources: ReadonlyMap<string, ArrayBuffer>
  readonly notices: readonly LoadNotice[]
}

/** 브라우저의 File이 그대로 들어맞는다. 읽는 일만 밖에서 시킨다. */
export type ReadableBinaryFile = FileIdentity & {
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

const count = (value: number) => value.toLocaleString('ko-KR')

/** 사람이 읽을 안내를 만든다. 무엇이 들었는지 하나, 모자란 것마다 하나씩. */
export function noticesOfModel(
  summary: ModelSummary,
  /** 묶음에서도 못 찾은 uri. 주지 않으면 바깥 파일을 하나도 못 찾은 것으로 본다. */
  missing?: readonly string[],
): LoadNotice[] {
  /*
   * STL에는 재질이라는 것이 없다. "재질 0개"라고 적으면 무엇이 빠진 것처럼 읽히니,
   * 없는 까닭과 어떻게 보일지를 대신 말한다.
   */
  const notices: LoadNotice[] = [
    {
      level: 'info',
      message:
        summary.format === 'stl'
          ? `삼각형 ${count(summary.triangles)}개를 읽었습니다. ` +
            'STL에는 색과 재질이 없어 한 가지 색으로 보여 줍니다.'
          : `메시 ${count(summary.meshes)}개, 재질 ${count(summary.materials)}개, ` +
            `삼각형 ${count(summary.triangles)}개를 읽었습니다.`,
    },
  ]

  /*
   * 폴더나 zip으로 들어왔으면 바깥 파일을 이미 찾아 놨다. 그때는 못 찾은 것만
   * 말한다. 다 찾았는데도 "빠진 채로 열립니다"를 띄우면 멀쩡한 화면을 두고 사람이
   * 무엇이 잘못됐나 찾게 된다.
   */
  const total = summary.externalResources.length
  const lost = missing ?? summary.externalResources
  const foundCount = total - lost.length

  if (foundCount > 0) {
    notices.push({
      level: 'info',
      message: `바깥 파일 ${count(foundCount)}개를 같은 폴더에서 찾아 함께 열었습니다.`,
    })
  }

  if (lost.length > 0) {
    const shown = lost.slice(0, 3).join(', ')
    const rest = lost.length - 3
    notices.push({
      level: 'warning',
      message:
        `이 ${MODEL_FORMAT_LABELS[summary.format]}가 가리키는 바깥 파일 ${count(lost.length)}개를 찾지 못했습니다` +
        `(${shown}${rest > 0 ? ` 외 ${count(rest)}개` : ''}). ` +
        '그 부분은 빠진 채로 열립니다. ' +
        (foundCount > 0
          ? '폴더에 같이 넣어 주시거나, '
          : '파일 하나만 떨어뜨리면 딸린 파일은 볼 수 없습니다. 폴더째 넣어 주시거나, ') +
        '블렌더에서 glTF Binary(.glb)로 내보내면 한 파일에 담깁니다.',
    })
  }

  if (summary.needsDecoder.length > 0) {
    notices.push({
      level: 'warning',
      message:
        `${summary.needsDecoder.join(', ')}이(가) 들어 있습니다. ` +
        '아직 그 해제기를 싣지 않아 열리지 않을 수 있습니다. ' +
        '내보낼 때 압축을 끄면 지금도 열립니다.',
    })
  }

  if (summary.animations > 0) {
    notices.push({
      level: 'info',
      message: `애니메이션 ${count(summary.animations)}개가 들어 있습니다. 지금은 첫 자세만 보여 줍니다.`,
    })
  }

  return notices
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export type ModelReadOptions = {
  /**
   * 이 파일이 들어 있던 묶음(폴더나 zip). 있으면 모델이 가리키는 바깥 파일을
   * 여기서 찾는다. 없으면 지금까지처럼 파일 하나만 읽는다.
   */
  readonly bundle?: FileBundle
}

/** 확장자로 형식을 고른다. 확장자 없이 앞머리로 GLB라고 판별된 파일은 GLB다. */
function formatOf(extension: string): ModelFormat {
  if (extension === 'gltf' || extension === 'obj' || extension === 'stl') return extension
  return 'glb'
}

/** 형식마다 "그릴 것이 없다"는 말이 다르다. 무엇이 빠졌는지가 다르기 때문이다. */
const NOTHING_TO_DRAW: Readonly<Record<ModelFormat, string>> = {
  glb: '그릴 메시가 없습니다. 카메라나 빈 노드만 들어 있는 파일로 보입니다.',
  gltf: '그릴 메시가 없습니다. 카메라나 빈 노드만 들어 있는 파일로 보입니다.',
  obj: '그릴 면이 없습니다. 꼭짓점이나 선만 들어 있는 OBJ는 아직 그리지 못합니다.',
  stl: '그릴 삼각형이 없습니다. 비어 있거나 중간에 잘린 STL로 보입니다.',
}

function summaryOf(format: ModelFormat, bytes: ArrayBuffer): ModelSummary {
  if (format === 'obj') return summarizeObj(new TextDecoder().decode(bytes))
  if (format === 'stl') return summarizeStl(bytes)
  const chunks = format === 'gltf' ? readGltfJson(new TextDecoder().decode(bytes)) : readGlb(bytes)
  return summarizeGltf(chunks.json, format)
}

type Resolved = { found: Map<string, ArrayBuffer>; missing: string[] }

/**
 * 모델이 가리키는 바깥 파일을 묶음에서 찾는다.
 *
 * OBJ만 두 번 찾는다. 색과 텍스처 이름은 OBJ가 아니라 `.mtl`에 적혀 있어서, `.mtl`을
 * 찾아 읽어야 그다음에 찾을 그림 이름이 나온다. 그림을 몇 장 가리키는지도 그때야
 * 알게 되므로 요약의 텍스처 수와 바깥 파일 목록을 여기서 다시 채운다.
 */
async function resolveModelResources(
  summary: ModelSummary,
  bundle: FileBundle | undefined,
): Promise<{ summary: ModelSummary } & Resolved> {
  const first: Resolved =
    summary.externalResources.length === 0 || bundle === undefined
      ? { found: new Map<string, ArrayBuffer>(), missing: [...summary.externalResources] }
      : await resolveResources(bundle, summary.externalResources)
  if (summary.format !== 'obj' || bundle === undefined || first.found.size === 0) {
    return { summary, ...first }
  }

  const textures: string[] = []
  for (const library of first.found.values()) {
    for (const name of texturesOfMtl(new TextDecoder().decode(library))) {
      if (!textures.includes(name)) textures.push(name)
    }
  }
  if (textures.length === 0) return { summary, ...first }

  const second = await resolveResources(bundle, textures)
  return {
    summary: {
      ...summary,
      textures: textures.length,
      externalResources: [...summary.externalResources, ...textures],
    },
    found: new Map([...first.found, ...second.found]),
    missing: [...first.missing, ...second.missing],
  }
}

export async function readModelFile(
  file: ReadableBinaryFile,
  options: ModelReadOptions = {},
): Promise<LoadedModel> {
  const format = formatOf(extensionOf(file.name))

  /*
   * 크기를 먼저 본다. 메시와 텍스처는 결국 GPU로 올라가고 그 버퍼는 파일 크기와
   * 대체로 같다. 넘치면 브라우저가 컨텍스트를 잃고 3D 화면이 통째로 까매진다.
   */
  const size = checkFileSize(file.name, file.size, 'model')
  if (size.level === 'block') throw new UnsupportedFileError(file.name, size.message)

  try {
    const bytes = await file.arrayBuffer()
    const counted = summaryOf(format, bytes)

    if (counted.meshes === 0) {
      throw new UnsupportedFileError(file.name, NOTHING_TO_DRAW[format])
    }

    /*
     * 바깥 파일을 묶음에서 찾는다. GLB와 STL은 가리키는 것이 없어서 이 일이 통째로
     * 건너뛰어진다 — 흔한 쪽이 빠른 길이다.
     */
    const { summary, found, missing } = await resolveModelResources(counted, options.bundle)

    return {
      assetId: assetIdOfFile(file),
      name: file.name,
      format,
      bytes,
      summary,
      resources: found,
      notices: [...sizeNotices(size), ...noticesOfModel(summary, missing)],
    }
  } catch (error) {
    if (error instanceof UnsupportedFileError) {
      // 아래에서 던진 것은 파일 이름을 모른다. 여기서 달아 준다.
      throw new UnsupportedFileError(file.name, error.message)
    }
    throw new UnsupportedFileError(file.name, `'${file.name}'을(를) 3D 모델로 읽지 못했습니다.`)
  }
}
