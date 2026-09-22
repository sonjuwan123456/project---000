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
 */

import { assetIdOfFile, type FileIdentity } from './assetId'
import { readGlb, readGltfJson, summarizeGltf, type GltfFormat, type GltfSummary } from './gltf'
import type { LoadNotice } from './loadTable'
import { checkFileSize, sizeNotices } from './sizeGuard'
import { UnsupportedFileError } from './unsupported'

export type LoadedModel = {
  /** 표와 같은 규칙으로 만든 id. 같은 파일을 다시 열면 같은 값이다. */
  readonly assetId: string
  readonly name: string
  readonly format: GltfFormat
  /**
   * 원본 바이트. 뷰가 three로 다시 파싱한다.
   *
   * 파싱한 장면이 아니라 바이트를 들고 있는 까닭은 층 때문만이 아니다. three의 장면
   * 객체는 GPU 자원을 쥐고 있어서 작업 공간 상태에 넣어 둘 것이 못 된다. 바이트는
   * 그냥 값이라 워커로 보낼 수도, 나중에 IndexedDB에 넣어 둘 수도 있다.
   */
  readonly bytes: ArrayBuffer
  readonly summary: GltfSummary
  readonly notices: readonly LoadNotice[]
}

/** 브라우저의 File이 그대로 들어맞는다. 읽는 일만 밖에서 시킨다. */
export type ReadableBinaryFile = FileIdentity & {
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

const count = (value: number) => value.toLocaleString('ko-KR')

/** 사람이 읽을 안내를 만든다. 무엇이 들었는지 하나, 모자란 것마다 하나씩. */
export function noticesOfModel(summary: GltfSummary): LoadNotice[] {
  const notices: LoadNotice[] = [
    {
      level: 'info',
      message:
        `메시 ${count(summary.meshes)}개, 재질 ${count(summary.materials)}개, ` +
        `삼각형 ${count(summary.triangles)}개를 읽었습니다.`,
    },
  ]

  if (summary.externalResources.length > 0) {
    const shown = summary.externalResources.slice(0, 3).join(', ')
    const rest = summary.externalResources.length - 3
    notices.push({
      level: 'warning',
      message:
        `이 glTF는 바깥 파일 ${count(summary.externalResources.length)}개를 가리킵니다` +
        `(${shown}${rest > 0 ? ` 외 ${count(rest)}개` : ''}). ` +
        '떨어뜨린 파일 하나만 볼 수 있어서 그 부분은 빠진 채로 열립니다. ' +
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

export async function readModelFile(file: ReadableBinaryFile): Promise<LoadedModel> {
  const extension = extensionOf(file.name)
  const format: GltfFormat = extension === 'gltf' ? 'gltf' : 'glb'

  /*
   * 크기를 먼저 본다. 메시와 텍스처는 결국 GPU로 올라가고 그 버퍼는 파일 크기와
   * 대체로 같다. 넘치면 브라우저가 컨텍스트를 잃고 3D 화면이 통째로 까매진다.
   */
  const size = checkFileSize(file.name, file.size, 'model')
  if (size.level === 'block') throw new UnsupportedFileError(file.name, size.message)

  try {
    const bytes = await file.arrayBuffer()
    const chunks =
      format === 'gltf' ? readGltfJson(new TextDecoder().decode(bytes)) : readGlb(bytes)
    const summary = summarizeGltf(chunks.json, format)

    if (summary.meshes === 0) {
      throw new UnsupportedFileError(
        file.name,
        '그릴 메시가 없습니다. 카메라나 빈 노드만 들어 있는 파일로 보입니다.',
      )
    }

    return {
      assetId: assetIdOfFile(file),
      name: file.name,
      format,
      bytes,
      summary,
      notices: [...sizeNotices(size), ...noticesOfModel(summary)],
    }
  } catch (error) {
    if (error instanceof UnsupportedFileError) {
      // 아래에서 던진 것은 파일 이름을 모른다. 여기서 달아 준다.
      throw new UnsupportedFileError(file.name, error.message)
    }
    throw new UnsupportedFileError(file.name, `'${file.name}'을(를) 3D 모델로 읽지 못했습니다.`)
  }
}
