import { describe, expect, it } from 'vitest'
import { VIEW_REGISTRY, arrangeViews, viewEntry, viewsFor } from './viewRegistry'

describe('VIEW_REGISTRY', () => {
  it('뷰 종류마다 한 줄씩만 있다', () => {
    const kinds = VIEW_REGISTRY.map((entry) => entry.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })

  it('선택 반응 기본값은 설계 문서 5장 표를 따른다', () => {
    expect(viewEntry('points').reaction).toBe('highlight')
    expect(viewEntry('table').reaction).toBe('filter')
    expect(viewEntry('distribution').reaction).toBe('filter')
  })
})

describe('viewsFor', () => {
  it('좌표를 놓을 수 있는 표는 3D 점, 표, 분포 그래프', () => {
    expect(viewsFor({ kind: 'table', placeable: true, chartable: true })).toEqual([
      'points',
      'table',
      'distribution',
    ])
  })

  it('좌표를 못 놓는 표는 3D를 빼고, 그릴 컬럼이 없으면 그래프도 뺀다', () => {
    expect(viewsFor({ kind: 'table', placeable: false, chartable: true })).toEqual([
      'table',
      'distribution',
    ])
    expect(viewsFor({ kind: 'table', placeable: false, chartable: false })).toEqual(['table'])
  })

  it('3D 모델과 글은 자기 뷰 하나', () => {
    expect(viewsFor({ kind: 'model' })).toEqual(['model'])
    expect(viewsFor({ kind: 'text' })).toEqual(['text'])
  })

  it('고른 뷰는 모두 그 자산 종류를 보는 뷰다', () => {
    for (const shape of [
      { kind: 'table', placeable: true, chartable: true },
      { kind: 'model' },
      { kind: 'text' },
    ] as const) {
      for (const kind of viewsFor(shape)) expect(viewEntry(kind).asset).toBe(shape.kind)
    }
  })
})

describe('arrangeViews', () => {
  it('3D가 있으면 무대에, 표는 아래에, 그래프는 옆에', () => {
    expect(arrangeViews(['points', 'table', 'distribution'])).toEqual({
      stage: 'points',
      side: ['distribution'],
      bottom: ['table'],
    })
  })

  it('3D가 없으면 표가 무대로 올라가고 아래 칸은 빈다', () => {
    expect(arrangeViews(['table', 'distribution'])).toEqual({
      stage: 'table',
      side: ['distribution'],
      bottom: [],
    })
  })

  it('3D 모델만 있으면 옆·아래가 빈다', () => {
    expect(arrangeViews(['model'])).toEqual({ stage: 'model', side: [], bottom: [] })
  })
})
