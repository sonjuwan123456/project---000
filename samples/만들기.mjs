/**
 * 샘플 파일을 만든다 (설계 문서 9장 M1 "샘플 데이터").
 *
 *   node samples/만들기.mjs
 *
 * 파일을 직접 고쳐도 되지만, 이 스크립트를 두는 까닭은 **왜 이 모양인지**를 적어
 * 둘 자리가 필요해서다. 샘플은 예쁜 데이터가 아니라 **읽개의 갈림길을 하나씩 밟는
 * 데이터**여야 한다. 그냥 눈으로 만들면 갈림길이 빠진 것을 알아채지 못한다.
 *
 * 씨앗 있는 난수를 쓴다. 다시 돌려도 같은 파일이 나와야 바뀐 것만 눈에 띈다.

 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const here = fileURLToPath(new URL('.', import.meta.url))
const out = (name, body) => {
  const path = here + name
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  writeFileSync(path, body)
}

// 아래 함수들이 한 번 만들어 두고 쓰는 것들. `let`은 끌어올려지지 않으므로 여기 둔다.
let cp949 = null
let table = null

let seed = 20260922

const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const gauss = () =>
  Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand())
const pick = (list) => list[Math.floor(rand() * list.length)]

for (const gone of ['고객문의.csv', '고객문의-euckr.csv', '깨진.csv', '주문.jsonl', '서버.log']) {
  rmSync(here + gone, { force: true })
}

/*
 * 표. 범주·숫자·날짜·글자 네 갈래가 다 들어가야 컬럼 종류 추론이 다 밟힌다.
 * emb_0..emb_7은 주성분 계산이 붙는 자리다 — 넓은 임베딩 컬럼을 벡터로 묶는 규칙.
 * 범주는 군집과 맞아떨어지게 만든다. 안 그러면 3D에서 색이 섞여 보이는 것이
 * 좌표 탓인지 라벨 탓인지 구분이 안 된다.
 */
const 분류 = ['배송문의', '환불요청', '교환요청', '결제오류', '쿠폰문의']
const 중심 = 분류.map(() => Array.from({ length: 8 }, () => gauss() * 3))
const 행 = [
  'id,분류,접수일,만족도,내용,' + Array.from({ length: 8 }, (_, i) => `emb_${i}`).join(','),
]
for (let i = 0; i < 200; i += 1) {
  const 갈래 = Math.floor(rand() * 분류.length)
  const 날 = new Date(Date.UTC(2026, 8, 1 + Math.floor(rand() * 21), Math.floor(rand() * 24)))
  // 만족도는 가끔 빈칸으로 둔다. 빈 값을 못 견디는 추론이 있으면 여기서 걸린다.
  const 만족도 = rand() < 0.08 ? '' : (1 + Math.floor(rand() * 5)).toString()
  /*
   * 내용은 길게 둔다. 짧은 문장을 돌려쓰면 값이 적어 **범주**로 접히고, 그러면 글자
   * 컬럼이 하나도 없는 표가 된다 — 컬럼 종류 추론의 한 갈래가 빈다. 가르는 기준은
   * 평균 길이 80자(`categoryMaxUnique`가 1000이라 200행으로는 개수로 넘길 수 없다).
   * 따옴표와 쉼표를 섞어 둔 것은 따옴표 안의 구분자를 밟으려는 것이다.
   */
  const 내용 =
    pick([
      '어제 받은 상자가 한쪽이 찌그러져 있었고, 안의 물건에도 눌린 자국이 남아 있습니다. 사진은 찍어 두었으니 필요하시면 보내 드리겠습니다. 같은 물건으로 바꿔 주시면 좋겠습니다',
      '주문한 것과 다른 색이 왔습니다. 주문 내역에는 남색으로 되어 있는데 검정이 왔어요. 포장은 뜯지 않은 그대로이고, 받은 날은 지난주 금요일입니다. 회수는 언제 오시는지 알려 주세요',
      '"빠른 배송" 정말 감사합니다. 다만 영수증이 안 들어 있어서 따로 받을 수 있을까요. 회사에 내야 해서 사업자 번호가 찍힌 것이 필요하고, 메일로 보내 주셔도 괜찮습니다',
      '결제는 어제 됐다고 문자가 왔는데 아직 배송 시작이 안 뜹니다. 언제쯤 출발하나요. 주말에는 집을 비우게 되어서, 가능하면 금요일 안에 받았으면 하는데 어려울까요',
    ]) + ` (접수번호 ${i + 1})`

  const emb = 중심[갈래].map((mid) => (mid + gauss() * 0.6).toFixed(3))
  행.push(
    [
      i + 1,
      분류[갈래],
      날.toISOString().slice(0, 19).replace('T', ' '),
      만족도,
      `"${내용.replaceAll('"', '""')}"`,
      ...emb,
    ].join(','),
  )
}
out('고객문의.csv', 행.join('\n') + '\n')

// 같은 표를 EUC-KR로. 표 읽개가 인코딩을 가리는지 눈으로 보는 자리다.
out('고객문의-euckr.csv', euckr(행.slice(0, 31).join('\n') + '\n'))

/*
 * 깨진 표. 셋을 한 파일에 섞는다 — 칸이 남는 행, 칸이 모자란 행, 닫히지 않은 따옴표.
 * 셋 다 파서가 오류 없이 삼켜 버리는 것들이라, 안내가 뜨는지 눈으로 보려면 필요하다.
 */
out(
  '깨진.csv',
  [
    'id,분류,만족도',
    '1,배송문의,5,군더더기',
    '2,환불요청',
    '3,"닫지 않은 따옴표,4',
    '5,쿠폰문의,2',
  ].join('\n') + '\n',
)

// 줄마다 객체 하나. ML 쪽에서 흔한 모양이고, 중첩 객체를 접는 규칙도 같이 밟는다.
const 주문 = []
for (let i = 0; i < 50; i += 1) {
  주문.push(
    JSON.stringify({
      주문번호: `A-${1000 + i}`,
      금액: Math.floor(rand() * 90000) + 5000,
      상태: pick(['결제완료', '배송중', '배송완료', '취소']),
      배송지: { 시: pick(['서울', '부산', '대구']), 구: pick(['중구', '남구', '북구']) },
    }),
  )
}
out('주문.jsonl', 주문.join('\n') + '\n')

// 로그. 네 레벨이 다 나와야 레벨 색과 거르기가 밟힌다.
const 로그 = []
for (let i = 0; i < 60; i += 1) {
  const 때 = new Date(Date.UTC(2026, 8, 22, 9, Math.floor(i / 2), (i * 17) % 60))
  const 레벨 = rand() < 0.1 ? 'ERROR' : rand() < 0.25 ? 'WARN' : rand() < 0.85 ? 'INFO' : 'DEBUG'
  const 말 = {
    ERROR: '업로드 실패: 연결이 끊어졌습니다',
    WARN: '응답이 느립니다 (1.8초)',
    INFO: `자산 열기 · 고객문의.csv (${200}행)`,
    DEBUG: '주성분 계산 캐시 적중',
  }[레벨]
  로그.push(`${때.toISOString().replace('T', ' ').slice(0, 19)} ${레벨} ${말}`)
}
out('서버.log', 로그.join('\n') + '\n')

/*
 * 갈라진 glTF. 폴더·zip을 받는 까닭 그 자체다 — 이 셋을 한꺼번에 넣어야 열린다.
 * 삼각형 하나지만 바깥 버퍼와 바깥 텍스처를 둘 다 가리킨다.
 */
const pos = [
  [-1, -1, 0],
  [1, -1, 0],
  [0, 1, 0],
]
const uv = [
  [0, 1],
  [1, 1],
  [0.5, 0],
]
const parts = []
for (const p of pos) parts.push(Buffer.from(Float32Array.from(p).buffer))
for (const t of uv) parts.push(Buffer.from(Float32Array.from(t).buffer))
parts.push(Buffer.from(Uint16Array.from([0, 1, 2]).buffer))
const bin = Buffer.concat(parts)
out('모형/scene.bin', bin)
out(
  '모형/scene.gltf',
  JSON.stringify(
    {
      asset: { version: '2.0', generator: '홀로그램 뷰어 샘플' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: '삼각형' }],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] },
      ],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ uri: 'textures/나무 바닥.png' }],
      buffers: [{ uri: 'scene.bin', byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 36, byteLength: 24, target: 34962 },
        { buffer: 0, byteOffset: 60, byteLength: 6, target: 34963 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [-1, -1, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
        { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
    },
    null,
    1,
  ) + '\n',
)
out('모형/textures/나무 바닥.png', png(8, 8, [200, 140, 60]))

/*
 * 갈라진 OBJ. glTF와 달리 **두 단계로** 갈라진다 — OBJ가 `.mtl`을 가리키고, 그 `.mtl`이
 * 다시 그림을 가리킨다. 그래서 `.mtl`을 찾아 읽어야 그다음에 찾을 그림 이름이 나온다.
 *
 * 덩어리 둘(상자·받침)이 재질 둘(나무·금속)을 쓴다. 상자의 면은 사각형이라 삼각형 둘로
 * 쪼개져 세어지고, 받침의 윗면은 육각형이라 넷으로 쪼개진다(k각형은 k-2개).
 */
const 상자 = [
  '# 홀로그램 뷰어 샘플',
  'mtllib 상자.mtl',
  'o 상자',
  ...[
    [-1, 0, -1],
    [1, 0, -1],
    [1, 2, -1],
    [-1, 2, -1],
    [-1, 0, 1],
    [1, 0, 1],
    [1, 2, 1],
    [-1, 2, 1],
  ].map(([x, y, z]) => `v ${x} ${y} ${z}`),
  ...[
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([u, v]) => `vt ${u} ${v}`),
  'usemtl 나무',
  // 꼭짓점/텍스처 좌표. 번호는 1부터 센다.
  'f 1/1 4/4 3/3 2/2',
  'f 5/1 6/2 7/3 8/4',
  'f 1/1 2/2 6/3 5/4',
  'f 4/1 8/2 7/3 3/4',
  'f 1/1 5/2 8/3 4/4',
  'f 2/1 3/2 7/3 6/4',
  'o 받침',
  ...Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i
    return `v ${(Math.cos(a) * 2).toFixed(4)} -0.1 ${(Math.sin(a) * 2).toFixed(4)}`
  }),
  'usemtl 금속',
  // 위에서 볼 때 반시계로 돌아야 윗면이 위를 본다.
  'f 14 13 12 11 10 9',
]
out('모형-obj/상자.obj', 상자.join('\n') + '\n')
out(
  '모형-obj/상자.mtl',
  [
    '# 홀로그램 뷰어 샘플',
    'newmtl 나무',
    'Kd 1 1 1',
    'Ns 40',
    'map_Kd textures/나뭇결.png',
    '',
    'newmtl 금속',
    'Kd 0.55 0.6 0.68',
    'Ns 600',
  ].join('\n') + '\n',
)
out('모형-obj/textures/나뭇결.png', png(8, 8, [176, 112, 58]))

/*
 * 이진 STL. 육각기둥 하나, 삼각형 24개(옆면 12, 윗면·아랫면 6씩).
 *
 * **머리 80바이트를 일부러 "solid"로 시작한다.** 글자판 STL이 "solid"로 시작하므로 앞머리만
 * 보면 글자판으로 잘못 읽는다. 실제로 그렇게 내보내는 CAD가 흔해서, 크기가 이진판 공식에
 * 맞는지를 먼저 보는 갈림길을 밟으라고 둔다. Z축이 위다 — STL의 관례대로.
 */
{
  const ring = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i
    return [Math.cos(a) * 3, Math.sin(a) * 3]
  })
  const faces = []
  for (let i = 0; i < 6; i += 1) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[(i + 1) % 6]
    faces.push([
      [ax, ay, 0],
      [bx, by, 0],
      [bx, by, 4],
    ])
    faces.push([
      [ax, ay, 0],
      [bx, by, 4],
      [ax, ay, 4],
    ])
    faces.push([
      [0, 0, 4],
      [ax, ay, 4],
      [bx, by, 4],
    ])
    faces.push([
      [0, 0, 0],
      [bx, by, 0],
      [ax, ay, 0],
    ])
  }
  const stl = Buffer.alloc(84 + faces.length * 50)
  Buffer.from('solid 홀로그램 뷰어 샘플 부품 (이진판)').copy(stl, 0, 0, 80)
  stl.writeUInt32LE(faces.length, 80)
  faces.forEach((face, index) => {
    let at = 84 + index * 50 + 12 // 법선은 0으로 둔다. 읽는 쪽이 면에서 다시 구한다.
    for (const corner of face) {
      for (const value of corner) {
        stl.writeFloatLE(value, at)
        at += 4
      }
    }
  })
  out('부품.stl', stl)
}

function png(width, height, rgb) {
  const chunk = (tag, data) => {
    const body = Buffer.concat([Buffer.from(tag), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head[8] = 8
  head[9] = 2
  const raw = Buffer.concat(
    Array.from({ length: height }, () =>
      Buffer.concat([
        Buffer.from([0]),
        Buffer.from(Array.from({ length: width }, () => rgb).flat()),
      ]),
    ),
  )
  const zlib = Buffer.concat([Buffer.from([0x78, 0x01]), deflateRawSync(raw), adler(raw)])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', zlib),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function adler(buffer) {
  let a = 1
  let b = 0
  for (const byte of buffer) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  const out = Buffer.alloc(4)
  out.writeUInt32BE(((b << 16) | a) >>> 0)
  return out
}
function crc32(buffer) {
  table ??= Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
/**
 * EUC-KR(CP949)로 적는다.
 *
 * 브라우저와 노드에는 **읽는 쪽만** 있고 쓰는 쪽이 없다. 그래서 읽는 쪽을 뒤집어
 * 표를 만든다 — 두 바이트 조합을 한 번씩 읽어 보고 글자가 나오면 그 글자의 자리로
 * 적어 둔다. 바깥 것을 하나 들이는 것보다 스무 줄이 낫다.
 */
function euckr(text) {
  if (cp949 === null) {
    cp949 = new Map()
    const decoder = new TextDecoder('euc-kr')
    for (let lead = 0x81; lead <= 0xfe; lead += 1) {
      for (let trail = 0x41; trail <= 0xfe; trail += 1) {
        const glyph = decoder.decode(Uint8Array.from([lead, trail]))
        if (glyph.length === 1 && glyph !== '�' && !cp949.has(glyph)) {
          cp949.set(glyph, [lead, trail])
        }
      }
    }
  }
  const bytes = []
  for (const glyph of text) {
    const code = glyph.codePointAt(0) ?? 0
    if (code < 0x80) {
      bytes.push(code)
      continue
    }
    const pair = cp949.get(glyph)
    if (pair === undefined) throw new Error(`EUC-KR로 적을 수 없는 글자입니다: ${glyph}`)
    bytes.push(...pair)
  }
  return Buffer.from(bytes)
}

console.log('샘플을 만들었습니다.')
