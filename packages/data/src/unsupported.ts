/**
 * 읽지 못한 파일을 알리는 오류.
 *
 * 형식마다 따로 두지 않는다. 부르는 쪽이 할 일은 어느 형식이었든 같기 때문이다 —
 * 사람에게 메시지를 그대로 보여 주는 것. 그래서 종류가 아니라 문구에 공을 들인다.
 */
export class UnsupportedFileError extends Error {
  readonly fileName: string

  constructor(fileName: string, message: string) {
    super(message)
    this.name = 'UnsupportedFileError'
    this.fileName = fileName
  }
}

/**
 * 표로 읽으려던 파일이 실은 그냥 글자였을 때.
 *
 * `.txt`가 로그인 일, JSON이 객체 배열이 아닌 일은 오류가 아니라 갈래를 잘못 짚은
 * 것이다. "읽지 못합니다"를 띄우는 대신 텍스트 패널로 넘긴다. `UnsupportedFileError`를
 * 물려받는 까닭은 이 길을 모르는 부르는 쪽이 지금까지처럼 문구를 보여 주면 되기
 * 때문이다. 아는 쪽만 갈래를 보고 다르게 움직인다.
 */
export class PreferTextError extends UnsupportedFileError {
  constructor(fileName: string, message: string) {
    super(fileName, message)
    this.name = 'PreferTextError'
  }
}
