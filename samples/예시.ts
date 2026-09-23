// 문법 강조가 무엇을 갈라 보여 주는지 확인하는 샘플이다. 돌아가는 코드는 아니다.
import { useState } from 'react'

/* 여러 줄 주석 안의 const 는 키워드가 아니다. 줄을 이어서 읽는지 보는 자리. */
const 인사 = '안녕하세요'
const 큰수 = 1_000_000
const 정규식 = /^[가-힣]+$/u

type 문의 = {
  분류: '배송문의' | '환불요청'
  만족도: number | null
}

export function 세는칸({ 처음 = 0 }: { 처음?: number }) {
  const [수, 바꾸기] = useState(처음)
  return {
    인사,
    큰수,
    맞는가: (글: string) => 정규식.test(글),
    더하기: () => 바꾸기((앞) => 앞 + 1),
    비우기: async (): Promise<문의[]> => [],
  }
}
