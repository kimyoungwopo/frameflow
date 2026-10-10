# Local Bridge

프로젝트 전용 Local Bridge입니다. 브라우저 쿠키나 세션스토리지를 읽지 않고, OAuth/PKCE와 provider adapter를 사용합니다. 기본값은 Codex OAuth 설정과 ChatGPT backend 이미지 endpoint입니다. 실제 계정의 허용 redirect URI와 이미지 endpoint 접근 권한은 별도 확인해야 합니다.

## 현재 계약

- `127.0.0.1:4319`에만 바인딩
- `GET /health`
- `GET /status`
- `POST /auth/start`
- `GET /auth/callback`
- `GET /auth/session-status`
- `POST /auth/logout`
- `POST /v1/generate`
- `POST /v1/edit`

세션 키는 자동 생성하며 OAuth와 이미지 endpoint에는 기본값이 있습니다. 이미지 요청에 유효한 인증 세션이 없으면 `401`을 반환합니다. `/v1/plan`은 기존 계정의 Codex OAuth로 GPT Responses를 호출합니다. 기본 모델은 gpt-6.1-sol이며 로컬 규칙으로 대체하지 않습니다.

## 공식 provider 설정

provider의 공식 문서에서 받은 값을 환경변수로 주입해야 합니다. 값을 소스코드나 브라우저에 넣지 않습니다.

```bash
export BRIDGE_SESSION_KEY='<base64-or-random-secret>'
export PROVIDER_AUTHORIZATION_URL='https://provider.example/authorize'
export PROVIDER_TOKEN_URL='https://provider.example/token'
export PROVIDER_CLIENT_ID='<official-client-id>'
export PROVIDER_REDIRECT_URI='http://127.0.0.1:4319/auth/callback'
export PROVIDER_SCOPE='<official-scope>'
export PROVIDER_GENERATE_URL='https://provider.example/v1/images/generate'
export PROVIDER_EDIT_URL='https://provider.example/v1/images/edit'
```

`BRIDGE_SESSION_KEY`가 없으면 로컬 사용자 데이터 디렉터리에 임시 키를 생성할 수 있습니다. 세션 파일과 키는 저장소 밖에 두며, 실제 값은 채팅·로그·저장소에 기록하지 않습니다.

기본 OAuth callback은 `http://127.0.0.1:4319/auth/callback`이며 로그인 완료 후 `http://127.0.0.1:4310/`으로 돌아옵니다. `BRIDGE_PORT`, `WEB_PORT`, `BRIDGE_RETURN_URL`로 변경할 수 있습니다. provider가 요구하는 redirect URI를 먼저 확인해야 합니다. 별도 callback 포트를 지정하면 해당 loopback 포트에만 callback 서버를 열며, 포트 충돌은 오류로 종료합니다. 자동으로 1455 포트를 열지 않습니다.

브라우저 요청은 loopback Host와 지정된 웹 Origin만 허용합니다. 별도 웹 주소는 `BRIDGE_ALLOWED_ORIGINS`에 쉼표로 구분하여 지정할 수 있습니다. Origin이 없는 로컬 서버 요청은 허용합니다. `/auth/device/start`, `/auth/device/status`, `/v1/plan`도 제공하며 plan은 기본 Responses endpoint를 사용하며 `PROVIDER_PLAN_MODEL`, `PROVIDER_PLAN_URL`로 변경할 수 있습니다.

만료된 세션은 상태 조회에서 로그인으로 표시하지 않습니다. provider 요청 시 refresh token이 있으면 토큰 endpoint에서 한 번 갱신하고 성공한 세션을 저장합니다. 갱신할 수 없거나 provider가 401을 반환하면 `401 authentication_required`를 반환합니다. 로그아웃은 진행 중인 device 인증과 callback state를 취소하며 늦게 도착한 인증 결과를 저장하지 않습니다.

이미지 요청은 32 MiB JSON 객체, 16,000자 이하의 비어 있지 않은 prompt, PNG/JPEG/WebP base64 이미지 최대 8개를 허용합니다. edit에는 입력 이미지가 필요합니다. 이미지 생성과 workflow 구성 요청은 클라이언트 연결이 끊기면 provider 요청도 중단합니다.

제공자 출력은 PNG/JPEG/WebP data URL로 통일합니다. HTTPS 출력 URL은 해당 요청의 제공자 endpoint와 같은 origin 또는 `PROVIDER_IMAGE_ORIGINS`에 쉼표로 지정한 정확한 HTTPS origin만 허용합니다(예: `https://images.example,https://cdn.example`). 기본 CDN 와일드카드는 없습니다. DNS 공개 주소를 확인해 그 주소로 연결하며 리다이렉트와 인증 헤더 전달을 금지합니다. MIME과 이미지 signature가 일치해야 하고, 이미지 원본 20 MiB·제공자 JSON 28 MiB·다운로드 전체 15초를 초과하면 실패합니다. 기존 클라이언트 이미지 입력은 계속 base64만 허용합니다.

## 실행 및 확인

```bash
npm start
curl http://127.0.0.1:4319/health
curl http://127.0.0.1:4319/status
curl -X POST http://127.0.0.1:4319/auth/start
```

위 명령은 `bridge` 폴더에서 실행합니다. 모의 테스트는 저장소 루트에서 `node --test bridge/tests/*.test.js`로 실행하며 임시 HOME과 모의 provider 응답만 사용합니다.

OAuth가 설정된 경우에만 `/auth/start`가 PKCE authorization URL을 반환합니다. callback에서는 state와 code verifier를 검증하고, access/refresh token은 브라우저 응답에 포함하지 않은 채 로컬 암호화 세션 파일에 저장합니다.
