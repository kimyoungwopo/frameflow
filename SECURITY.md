# Security Policy

## 공개하지 말아야 할 정보

API key, token, OAuth secret, password, session/cookie, device authorization 값, 연결 문자열, 개인 경로, 개인 계정 식별자를 이슈나 로그에 올리지 마세요.

## 신고

재현 가능한 보안 취약점은 공개 이슈 대신 저장소 소유자가 제공하는 비공개 보안 연락처로 신고하세요. 아직 전용 연락처가 배정되지 않은 배포본에서는 민감정보 없이 공개 이슈를 먼저 열어 보안 신고 채널 개설을 요청할 수 있습니다.

취약점 신고에는 영향 범위, 최소 재현 절차, 영향받는 버전을 포함하되 credential과 개인정보는 포함하지 마세요.

## 운영 원칙

- 기본 테스트는 mock/fixture 기반으로 실행합니다.
- 실제 provider와 인증은 opt-in으로만 사용합니다.
- 비밀값은 환경변수 또는 사용자의 로컬 secret store에서만 주입합니다.
- 공개 로그에는 token, cookie, authorization header, 개인 경로를 남기지 않습니다.
