import { describe, expect, it } from 'vitest'
import { summarizeObj, texturesOfMtl } from './wavefront'

const cube = [
  '# Blender 4.2.0',
  '# www.blender.org',
  'mtllib 상자.mtl',
  'o 상자',
  'v -1 -1 -1',
  'v 1 -1 -1',
  'v 1 1 -1',
  'v -1 1 -1',
  'v -1 -1 1',
  'v 1 -1 1',
  'v 1 1 1',
  'v -1 1 1',
  'usemtl 나무',
  'f 1 4 3 2',
  'f 5 6 7 8',
  'f 1 2 6 5',
  'usemtl 금속',
  'f 4 8 7 3',
  'f 1 5 8 4',
  'f 2 3 7 6',
].join('\n')

describe('summarizeObj', () => {
  it('사각형 면은 삼각형 둘로 센다', () => {
    const summary = summarizeObj(cube)
    expect(summary.format).toBe('obj')
    expect(summary.triangles).toBe(12)
    expect(summary.meshes).toBe(1)
  })

  it('k각형 면은 삼각형 k-2개다 — 점이 둘뿐인 면은 세지 않는다', () => {
    const text = [
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'v 0 2 0',
      'f 1 2 3 4 5',
      'f 1 2',
    ].join('\n')
    expect(summarizeObj(text).triangles).toBe(3)
  })

  it('재질은 이름이 다른 것만 센다', () => {
    const text = cube + '\nusemtl 나무\nf 1 2 3'
    expect(summarizeObj(text).materials).toBe(2)
  })

  it('가리키는 .mtl을 바깥 파일로 적는다 — 이름의 공백까지 그대로', () => {
    expect(summarizeObj(cube).externalResources).toEqual(['상자.mtl'])
    expect(summarizeObj('mtllib 나무 상자.mtl\nf 1 2 3').externalResources).toEqual([
      '나무 상자.mtl',
    ])
  })

  it('o와 g마다 덩어리가 새로 시작되고, 면이 없는 덩어리는 버린다', () => {
    const text = ['o 하나', 'f 1 2 3', 'g 빈것', 'o 둘', 'f 1 2 3', 'f 1 2 3'].join('\n')
    expect(summarizeObj(text).meshes).toBe(2)
  })

  /*
   * `OBJLoader`는 첫 선언을 만나면 이미 쓰던 이름 없는 덩어리에 그 이름을 붙이고
   * 이어 쓴다. 여기서 둘로 세면 화면에는 하나가 뜨는데 패널에는 둘이 적힌다.
   */
  it('첫 선언 앞에 나온 면은 첫 덩어리와 한 메시가 된다', () => {
    const text = ['f 1 2 3', 'o 첫째', 'f 1 2 3', 'o 둘째', 'f 1 2 3'].join('\n')
    expect(summarizeObj(text).meshes).toBe(2)
  })

  it('줄 끝의 역슬래시는 다음 줄과 잇는다', () => {
    expect(summarizeObj('f 1 2 \\\n3 4').triangles).toBe(2)
  })

  it('윈도 줄바꿈도 같게 센다', () => {
    expect(summarizeObj(cube.replaceAll('\n', '\r\n')).triangles).toBe(12)
    expect(summarizeObj('mtllib 상자.mtl\r\nf 1 2 3').externalResources).toEqual(['상자.mtl'])
  })

  it('첫 줄 주석을 만든 곳으로 본다', () => {
    expect(summarizeObj(cube).generator).toBe('Blender 4.2.0')
    expect(summarizeObj('v 0 0 0\n# Blender').generator).toBeNull()
    expect(summarizeObj(`# ${'설명'.repeat(50)}\nf 1 2 3`).generator).toBeNull()
  })

  it('면이 없으면 메시도 없다', () => {
    const summary = summarizeObj('v 0 0 0\nv 1 0 0\nl 1 2')
    expect(summary.meshes).toBe(0)
    expect(summary.triangles).toBe(0)
  })
})

describe('texturesOfMtl', () => {
  it('three가 불러오는 텍스처 줄에서 이름만 뗀다', () => {
    const mtl = [
      'newmtl 나무',
      'Kd 1 1 1',
      'map_Kd textures/나뭇결.png',
      'map_Bump -bm 0.5 textures/결.png',
      'newmtl 금속',
      'map_Kd -s 2 2 1 -o 0.5 0.5 0 금속 판.jpg',
      'norm 법선.png',
    ].join('\n')
    expect(texturesOfMtl(mtl)).toEqual([
      'textures/나뭇결.png',
      'textures/결.png',
      '금속 판.jpg',
      '법선.png',
    ])
  })

  it('같은 그림은 한 번만 적는다', () => {
    expect(texturesOfMtl('map_Kd a.png\nmap_d a.png')).toEqual(['a.png'])
  })

  it('three가 읽지 않는 줄과 주석은 건너뛴다', () => {
    expect(texturesOfMtl('# map_Kd 주석.png\nmap_Ns 광택.png\nmap_Ka 주변.png')).toEqual([])
  })

  it('주소로 적힌 그림은 묶음에서 찾을 것이 아니다', () => {
    expect(texturesOfMtl('map_Kd https://example.com/a.png')).toEqual([])
  })
})
