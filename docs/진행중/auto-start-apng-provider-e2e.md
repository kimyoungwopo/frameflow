# 자동 시작·APNG·provider E2E 후속 작업

상태: 부분 완료

## 2. Web/Bridge 자동 시작

완료:

- `scripts/macos-start.sh`
  - 프로젝트 디렉터리로 이동
  - `.frameflow-server.env`가 있으면 로드
  - Web과 Bridge를 루트 `server.js`로 함께 시작
- `scripts/macos-install-launchd.cjs`
  - `~/Library/LaunchAgents/com.frameflow.studio.plist` 생성
  - 로그인 시 시작 및 비정상 종료 시 재시작 설정
  - 로그는 프로젝트 `logs/`에 저장
- `scripts/macos-uninstall-launchd.cjs`
- npm 명령:
  - `npm run macos:install`
  - `npm run macos:uninstall`

현재 실행 중인 4310/4319 프로세스와 충돌하지 않도록 이번 검증에서는 launchd bootstrap을 실제 실행하지 않았다. 설치 시 기존 수동 프로세스를 먼저 종료하거나 포트를 변경해야 한다.

Quick Tunnel은 임시 URL이므로 launchd에 포함하지 않았다.

## 3. APNG

완료:

- `upng-js` 추가
- `FORMAT:APNG` 또는 `OUTPUT:APNG` motion prompt 지원
- RGBA 프레임을 browser-side APNG로 인코딩
- 기본 GIF 경로는 유지
- VM 테스트에는 deterministic APNG mock 추가

실제 encoder 확인:

- PNG signature 확인
- `acTL` animation control chunk 확인
- `fcTL` frame control chunk 확인
- 2프레임 입력으로 132바이트 APNG 생성

## 4. provider/GIF E2E

준비 완료:

- `npm run provider:e2e-check`
- Bridge `/status`를 읽어 인증 상태와 실행 가능 여부를 출력
- provider 호출을 자동으로 발생시키지 않음
- 비용이 발생할 수 있는 실제 생성은 사용자 승인 이후에만 수행

현재 확인:

```json
{
  "httpStatus": 200,
  "bridge": true,
  "authenticated": true,
  "providerAuthReady": true,
  "providerCallExecuted": false,
  "e2eReady": false
}
```

즉, Bridge와 인증 구성은 확인했지만 실제 이미지/프레임 생성 및 GIF/APNG 결과까지의 provider E2E는 비용 승인 전이라 미실행이다.

## 검증

- `npm test`: 178개 통과, 0개 실패
- `npm run typecheck`: 통과
- `npm run build`: 통과
- `npm run agent:check`: 통과
- launchd 스크립트 `node --check`: 통과
- shell script `zsh -n`: 통과
- APNG encoder 직접 smoke: 통과
