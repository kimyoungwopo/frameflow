최신 자연어 구성은 실제 GPT 기반으로 변경했습니다. [GPT 구성 검증](GPT-PLANNING.md)을 참조하세요. 아래는 이전 개선 기록입니다.

# 추가 개선 검증 — 2026-10-07

현재 완료 범위: 자동 구성 요청 중복 차단·취소 후 늦은 응답 차단, 실행 취소, REPEAT 포함 예상 요청 수, 프로젝트별 이미지 저장소의 오래된 레코드 정리, 이미지 포함 JSON 백업 내보내기·새 프로젝트로 가져오기, UPSCALE 배율 미보장 표시, 320px 헤더 넘침 수정.

`npm test`: 33개 통과, 실패 0. `npm run typecheck` 및 최종 `npm run build` 통과.

실제 저장된 계정으로 생성 요청 1회와 편집 요청 1회 모두 HTTP 200과 이미지 반환을 확인했습니다. 토큰과 계정 식별자는 기록하지 않았습니다. 생성 결과 요약은 provider-smoke.json, 편집 결과 요약은 provider-edit-smoke.json, 편집 PNG는 provider-edit-result.png에 있습니다. 신규 로그인 및 다른 계정 호환성, 고정 배율 업스케일은 검증하지 않았습니다.

브라우저에서는 모의 provider로 자연어 구성, 예상 1회 표시, 실행 → 취소 → '작업 실행을 취소했어요'와 빈 PREVIEW, 백업 다운로드, 다운로드한 백업 가져오기 → 3노드·2연결·PREVIEW·보관함 복원을 확인했습니다. 파일 가져오기 첫 검증 중 File.text 읽기 지연을 발견하여 취소 가능한 FileReader로 변경한 후 복원을 확인했습니다. Chrome 콘솔 error/warn 0개.

화면 폭 390/768에서 가로 넘침 없음. 320에서 헤더 메뉴 넘침을 발견하여 한 열 레이아웃으로 수정한 후 실제 웹에서 viewport=pageWidth=320 확인. 1280 화면도 시각 확인. followup-desktop.png은 모의 결과를 복원한 화면, followup-mobile.png/followup-tablet.png은 반응형 화면, followup-ready.png은 최종 실제 웹입니다.

현재 실제 웹은 http://127.0.0.1:4340 에 최신 빌드로 실행 중이며 모의 QA 서버는 종료했습니다. 네이티브 앱은 생성·빌드하지 않았습니다. Undo/Redo와 대규모 화면 컴포넌트 분리는 후속 개선으로 남아 있습니다.

![최종 웹](followup-ready.png)

---

아래는 최초 웹 전환 시점의 검증 기록입니다. 당시 provider 미검증 사항은 위 추가 검증 결과로 갱신되었습니다.

# 웹 전용 전환 검증

2026-10-07, 최종 자체 검토 결과: 통과. 실제 계정으로 이미지 생성하는 provider 호환성은 검증 범위 밖입니다.

## 변경

- 루트 실행 명령이 Next.js 웹과 Local Bridge를 함께 시작합니다. macOS 앱은 생성·빌드하지 않습니다.
- 그래프 실행은 노드별 결과를 추적합니다. 분기 결과, PREVIEW, BLEND, REPEAT가 연결선에 따라 동작합니다.
- PROMPT·COMMAND의 중복 이미지 요청을 제거하고 인증 실패 시 전체 실행을 중단합니다.
- PNG/WebP 투명도, 프로젝트별 이미지 저장, PREVIEW 복원, 로그인 polling 정리, 입력·Origin 검사와 모바일 레이아웃을 수정했습니다.

## 자동 검증

`npm test`: 27 tests, 27 pass, 0 fail.

`npm run typecheck`: 통과. 최종 `npm run build`에서도 TypeScript 검사와 9개 페이지 생성이 통과했습니다.

수정 전 회귀 재현: 제품 편집 요청 2회(기대 1회), 분기의 두 번째 입력이 원본 대신 `result-1`, 401 이후 요청 3회(기대 1회). 같은 실행 함수의 회귀 검사가 수정 후 모두 통과했습니다.

## 실제 표면 검증

| 시나리오 | 관찰 | 근거 |
| --- | --- | --- |
| 브라우저 자연어 구성·생성 | 3개 노드·2개 연결 생성 후 완료 및 PREVIEW 반영 | web-desktop.png, 모의 provider wire log: `/generate`, inputImages 0, 호출 1회 |
| 저장·새로고침 | PREVIEW와 보관함 복원 | 브라우저 AX: `PREVIEW 3 결과`, `Results · 1` |
| 프로젝트 A → 빈 B → A | B에 A의 이미지가 나타나지 않고 A 재열기에서 복원 | 브라우저 프로젝트 메뉴와 PREVIEW 상태 |
| PNG 업로드 | 결과가 `data:image/png`이며 투명도 유지 | tests/fixtures/transparent.png, 브라우저 출력 PNG alpha min/max 89/89 |
| 연결 없는 입력 실행 | PREVIEW 추가 오류 표시, provider 호출 없음 | 브라우저 AX: `실행 결과를 확인할 PREVIEW 노드를 추가해 주세요.` |
| 모바일·태블릿 | 폭 390/768에서 pageWidth가 각각 390/768, 실행 버튼과 설정 패널 접근 가능 | web-mobile.png, web-tablet.png |
| 잘못된 URL | `/%ZZ` → 404, 서버 정상 유지 | 실제 Next.js HTTP 요청 |
| 외부 Host | `http.request`에서 Host `evil.example` → 403 origin_forbidden | 실제 웹 HTTP 요청 |
| 최종 실행 | 새 웹 4340, Bridge 4349, 기존 포트의 프로세스 유지 | web-ready.png, 루트 launcher 출력 |

## 운영 상태와 한계

실제 웹은 http://127.0.0.1:4340 에 실행 중입니다. 4310/4319의 기존 프로세스가 실행 중이어서 새 웹은 다른 포트를 사용했습니다. 기본 시작 포트는 4310/4319이며 실행 시 WEB_PORT/BRIDGE_PORT로 변경할 수 있습니다.

브라우저 생성 검증은 `tests/serve-qa.cjs`의 임시 HOME과 모의 provider를 사용했습니다. 테스트 서버와 임시 세션은 종료·정리했으며 모의 이미지를 실제 생성 결과로 주장하지 않습니다. 최종 실제 웹에서는 provider 이미지 요청을 보내지 않았습니다.

이 폴더는 Git 저장소가 아니므로 Git diff 검증은 수행하지 않았습니다. 기존 앱·zip·Swift와 정적 UI 파일은 이전 버전 자료로 남겨 두었으며 새 웹 실행 경로에는 포함되지 않습니다. 새 실행기, 이미지 저장소, API 입력 처리 모듈은 각각 한 책임을 가지며 타입 억제 지시문과 새 의존성을 추가하지 않았습니다.

![웹 실행 화면](web-ready.png)
![모의 이미지로 생성 검증](web-desktop.png)
