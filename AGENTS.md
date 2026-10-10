# Frameflow Project Agent Rules

## 프로젝트 정체성

- 이 저장소는 이미지 생성·편집·합성·결과 관리와 이미지 기반 스프라이트 모션 GIF를 만드는 Frameflow 작업실이다.
- 서비스 사용자에게는 Next.js, Bridge, OAuth 같은 내부 구현명을 노출하지 않는다. 사용자 표현은 계정 연결, 이미지 생성, 이미지 편집, 이미지 합성, 선명도 개선, 반복 개선, 스프라이트 모션, 결과 미리보기를 사용한다.
- 자체 브랜드를 유지하며 다른 서비스의 이름·로고·문구·영상 범위를 복제하지 않는다.

## 핵심 작업 모델

- 자연어는 planner 입력이다. planner는 자연어를 PROMPT에 스타일 단어로 복사하지 않고 실행 가능한 workflow graph로 변환한다.
- COMMAND 노드 하나에는 여러 명령어를 순서대로 담을 수 있다. 예: `/RAIN /NIGHTFLASH /MOTIONBLUR`.
- 명령어 조합은 기존 `shared/command-catalog.json`의 지원 코드만 사용한다. 알 수 없는 코드는 검증 오류로 처리한다.
- 장면·피사체·보존·금지 조건은 COMMAND의 코드와 분리된 PROMPT 지시로 보존한다.
- 자연어의 스타일 의도는 여러 COMMAND 코드 조합으로 해석한다. 명령어마다 별도 COMMAND 노드를 만들지 않는다.
- 명령어 조합은 가능한 한 하나의 이미지 작업 요청으로 실행하며, 노드 수를 늘려 비용을 숨기지 않는다.
- GIF·APNG·sprite·animation·frame·모션 요청에는 반드시 `motion` 노드를 사용한다. sprite sheet를 외부 도구로 자르라는 우회 안내를 하지 않는다.
- 기본 스프라이트 모션은 8프레임·6fps·무한 반복 GIF이며 `FRAMES:n FPS:n`을 허용한다. 프레임은 4~12 범위로 제한한다.
- 픽셀 모션은 하드 픽셀 엣지, 블러·보간 제거, 캐릭터 실루엣·팔레트·카메라·앵커·투명 배경 보존을 우선한다. `ghosttrail`은 분리된 픽셀 잔상으로 해석한다.

## 구조와 실행

- `web/`: Next.js 사용자 화면과 브라우저 GIF 인코더.
- `bridge/`: 인증 세션, planner/provider 호출, planner 응답 검증.
- `shared/command-catalog.json`: UI와 Bridge가 공유하는 명령어 원본.
- `shared/style-keywords.json`: 자연어 해석 보조 vocabulary이며 공식 slash command 목록을 대체하지 않는다.
- `tests/`: planner, command combination, workflow 검증.
- 기본 개발 포트는 Web `4310`, Bridge `4319`. Bridge는 외부에 직접 공개하지 않는다.

## 변경 규칙

- 기존 인증/OAuth/Device/Bridge/provider 호출과 세션 저장 구조를 보존한다.
- 원본 자산·기존 CSS·기존 프로젝트 데이터를 덮어쓰지 않는다. 필요한 경우 최소 범위로 패치한다.
- 실제 provider 호출은 인증·비용·외부 전송이 수반될 수 있으므로 사용자 승인 없이 실행하지 않는다. 모의 provider와 구조 검증을 우선한다.
- 토큰, API 키, 비밀번호, 연결 문자열, 세션 값은 파일·로그·문서에 기록하지 않는다. 문서에는 `[REDACTED]`만 사용한다.
- 자동 재시도나 실패 은폐를 추가하지 않는다. planner/graph/provider 오류는 명시적으로 표시하고 기존 플로우를 보존한다.

## 작업 시작·완료 게이트

1. 이 파일과 `docs/상태/README.md`를 읽는다.
2. 관련 `docs/작업`, `docs/생각`, `docs/아이디어`, `docs/진행중`, `docs/완료`를 확인한다.
3. 작업 범위와 acceptance criteria를 task note에 기록한다.
4. `npm run agent:check`를 실행한다.
5. 변경 후 관련 테스트, `npm run typecheck`, `npm run build`를 실행한다.
6. UI 변경은 실제 브라우저에서 overflow·콘솔 오류·핵심 흐름을 확인한다.
7. 완료했다고 말하기 전에 `npm run agent:check`와 exact evidence를 completion note에 남긴다.

## 절대 기준

- 컴파일 성공만으로 완료라고 하지 않는다.
- planner가 만든 그래프는 node type, 연결, cycle, 입력, preview, command code, motion 조건을 검증한다.
- 실제로 확인하지 않은 provider·GIF·배포 결과를 성공했다고 기록하지 않는다.
