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
