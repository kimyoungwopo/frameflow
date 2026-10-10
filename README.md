# Frameflow

Frameflow는 이미지 생성·편집 작업을 노드 그래프로 구성하고, 결과를 프로젝트 단위로 관리하는 로컬 웹 스튜디오입니다.

## 공개 범위

공개 저장소에는 다음이 포함됩니다.

- 노드 그래프 실행과 검증
- 이미지 provider adapter 계약
- mock/fixture 기반 테스트
- motion atlas 분할·검증
- GIF/APNG 인코딩
- 로컬 웹 스튜디오와 Local Bridge

hosted 서비스, 운영 배포 설정, 개인 계정 인증 상태, 실제 provider credential, 생성 결과물과 QA 캡처는 공개 저장소에 포함하지 않습니다. 실제 provider 연결은 사용자가 공식 문서에 따라 별도로 설정하는 opt-in 경로입니다.

Frameflow 이름·로고·hosted 서비스 식별자는 코드 라이선스와 별도 권리입니다. 자세한 내용은 [TRADEMARKS.md](TRADEMARKS.md)를 확인하세요.

## 요구 사항

- Node.js 22 이상
- 실제 provider 없이도 테스트 가능한 로컬 환경

## 설치와 실행

```bash
npm install
npm run setup
npm run dev
```

기본 주소: <http://127.0.0.1:4310>

프로덕션 빌드:

```bash
npm run build
npm start
```

포트 변경:

```bash
WEB_PORT=4320 BRIDGE_PORT=4329 npm start
```

## Local Bridge

웹 앱과 Local Bridge는 기본적으로 loopback에만 바인딩됩니다. 실제 provider를 사용하지 않는 테스트는 모의 응답과 임시 HOME을 사용합니다.

공개 웹 앱에 연결할 때는 사용자가 신뢰하는 HTTPS origin만 명시적으로 지정하세요.

```bash
npm run bridge -- --origin https://YOUR-SITE.example
```

연결 키와 provider credential은 저장소·이슈·로그·브라우저 URL에 기록하지 마세요. 공식 provider의 OAuth/API 설정은 환경변수로만 주입하며, 기본 실행이나 테스트에서 계정·유료 API 호출을 요구하지 않습니다. 상세 계약은 [bridge/README.md](bridge/README.md)를 확인하세요.

## Motion atlas 정책

Frameflow는 provider가 반환한 atlas를 임의로 crop·patch·수동 보정하지 않습니다. 가로 방향의 동일 셀 atlas가 프레임 수와 정확히 나뉘지 않으면 실패 처리합니다. fixture 테스트는 provider 비용 없이 분할·경계·투명도·GIF/APNG 인코딩을 검증합니다.

## 검증 명령

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

`npm test`와 `npm run public:check`는 계정이나 API 키 없이 실행되어야 합니다. 실제 provider smoke/E2E는 별도 opt-in이며 공개 릴리스의 기본 검증으로 간주하지 않습니다.

## 개인정보·비밀정보 정책

공개 전에 다음을 저장소에 넣지 않습니다.

- API key, access/refresh token, OAuth secret, password, connection string
- session/cookie/browser profile/device authorization state
- 개인 이메일·계정 식별자·사용자 홈 경로
- 실제 tunnel/deployment URL과 개인 QA 캡처
- source map을 포함한 로컬 빌드 산출물

`.env.example`와 fixture에는 비기능 placeholder만 사용합니다. 공개 전에는 [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md)의 clean-room staging 검사를 수행하세요.

## 라이선스

소스 코드는 Apache License 2.0으로 배포합니다. [LICENSE](LICENSE)를 참고하세요. 제3자 dependency와 샘플 asset에는 각각의 라이선스가 적용됩니다.

## 보안 취약점 신고

공개 이슈에 credential이나 재현 가능한 민감정보를 올리지 마세요. 신고 절차는 [SECURITY.md](SECURITY.md)를 확인하세요.
