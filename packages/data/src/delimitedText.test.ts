import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseDelimitedText } from './delimitedText'

describe('detectDelimiter', () => {
  it('헤더 줄에서 구분자를 고른다', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
  })

  it('따옴표 안의 구분자는 세지 않는다', () => {
    expect(detectDelimiter('"a\tb\tc\td"\tx')).toBe('\t')
    expect(detectDelimiter('"a,b,c,d",x\n1,2')).toBe(',')
  })
})

describe('parseDelimitedText', () => {
  it('컬럼별 배열로 갈라 놓는다', () => {
    const table = parseDelimitedText('이름,나이\n가나,30\n다라,41\n')
    expect(table.header).toEqual(['이름', '나이'])
    expect(table.rowCount).toBe(2)
    expect(table.columns[0]).toEqual(['가나', '다라'])
    expect(table.columns[1]).toEqual(['30', '41'])
  })

  it('따옴표 안의 쉼표와 줄바꿈을 지킨다', () => {
    const table = parseDelimitedText(
      '문의,분류\n"배송이 늦고, 연락도 없습니다\n다시 확인 부탁드립니다",배송\n',
    )
    expect(table.rowCount).toBe(1)
    expect(table.columns[0]?.[0]).toBe('배송이 늦고, 연락도 없습니다\n다시 확인 부탁드립니다')
    expect(table.columns[1]?.[0]).toBe('배송')
  })

  it('겹따옴표 둘은 따옴표 하나다', () => {
    const table = parseDelimitedText('말\n"그가 ""안 왔다""고 합니다"\n')
    expect(table.columns[0]?.[0]).toBe('그가 "안 왔다"고 합니다')
  })

  it('CRLF와 마지막 줄바꿈 없는 파일을 함께 처리한다', () => {
    const table = parseDelimitedText('a,b\r\n1,2\r\n3,4')
    expect(table.rowCount).toBe(2)
    expect(table.columns[1]).toEqual(['2', '4'])
  })

  it('빈 칸은 null로 두고 짧은 행의 뒤를 채운다', () => {
    const table = parseDelimitedText('a,b,c\n1,,3\n4,5\n')
    expect(table.columns[1]).toEqual([null, '5'])
    expect(table.columns[2]).toEqual(['3', null])
  })

  it('헤더보다 칸이 많은 행을 알린다', () => {
    const table = parseDelimitedText('a,b\n1,2,3\n')
    expect(table.overflowRows).toEqual([0])
  })

  it('엑셀이 붙인 BOM을 떼고 첫 컬럼 이름을 읽는다', () => {
    const table = parseDelimitedText('﻿이름,나이\n가나,30\n')
    expect(table.header[0]).toBe('이름')
  })

  it('이름이 빈 컬럼에는 자리 이름을 준다', () => {
    const table = parseDelimitedText('a,,c\n1,2,3\n')
    expect(table.header[1]).toBe('컬럼 2')
  })
})

describe('성하지 않은 파일', () => {
  /*
   * 파서는 웬만하면 오류를 내지 않는다. 그래서 무엇이 어긋났는지 여기서 세어 두지
   * 않으면, 사람은 자기 행이 어디로 갔는지 모른 채 멀쩡해 보이는 표를 본다.
   */
  it('헤더보다 칸이 적은 행을 센다', () => {
    const parsed = parseDelimitedText('a,b,c\n1,2\n3,4,5\n6\n')
    expect(parsed.shortRows).toEqual([0, 2])
    expect(parsed.overflowRows).toEqual([])
  })

  it('통째로 빈 줄은 모자란 것으로 세지 않는다 — 파일 끝의 빈 줄이 흔하다', () => {
    expect(parseDelimitedText('a,b\n1,2\n\n3,4\n\n').shortRows).toEqual([])
  })

  it('넘친 행과 모자란 행을 따로 센다 — 사람이 할 일이 다르다', () => {
    const parsed = parseDelimitedText('a,b\n1,2,3\n4\n')
    expect(parsed.overflowRows).toEqual([0])
    expect(parsed.shortRows).toEqual([1])
  })

  it('따옴표가 닫히지 않은 채 끝나면 그렇다고 알린다', () => {
    expect(parseDelimitedText('a,b\n"열린 것,2\n3,4\n').unterminatedQuote).toBe(true)
  })

  it('성한 파일에서는 아무것도 걸리지 않는다', () => {
    const parsed = parseDelimitedText('a,b\n1,2\n"닫은 것",4\n')
    expect(parsed.shortRows).toEqual([])
    expect(parsed.overflowRows).toEqual([])
    expect(parsed.unterminatedQuote).toBe(false)
  })

  it('따옴표 안의 줄바꿈은 성한 것이다', () => {
    const parsed = parseDelimitedText('a,b\n"두\n줄",2\n')
    expect(parsed.unterminatedQuote).toBe(false)
    expect(parsed.rowCount).toBe(1)
    expect(parsed.shortRows).toEqual([])
  })
})
