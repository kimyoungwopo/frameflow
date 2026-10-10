# 공개 전 체크리스트

## 공개 경계

- [ ] 공개할 파일 목록을 clean-room staging에서 확정한다.
- [ ] 원본과 개인 결과물은 저장소 밖의 비공개 백업에 보관한다.
- [ ] hosted 운영 코드·배포 설정·계정 연결 상태를 별도 운영 영역으로 분리한다.
- [ ] `git diff --cached --name-only`로 의도하지 않은 파일이 없는지 확인한다.

## 개인정보와 비밀정보

- [ ] API key, bearer/access/refresh token, OAuth secret, password, connection string이 없다.
- [ ] session/cookie/browser profile/device authorization 파일이 없다.
- [ ] 개인 이메일, 계정 식별자, 사용자 홈 경로가 없다.
- [ ] 실제 tunnel/deployment URL, 로컬 캡처, 브라우저 화면이 없다.
- [ ] `.env`, `.frameflow-server.env`, 개인 로그가 stage되지 않는다.
- [ ] 이미지·영상·압축파일의 픽셀/프레임과 메타데이터를 확인한다.
- [ ] source map과 로컬 빌드 산출물을 제외한다.

## 재현성

- [ ] 기본 테스트가 계정/API key 없이 통과한다.
- [ ] mock provider와 fixture만으로 motion atlas/GIF/APNG QA가 재현된다.
- [ ] 실제 provider 호출은 명시적 opt-in이다.
- [ ] atlas 규격 불일치를 crop/patch로 숨기지 않고 실패 처리한다.
- [ ] README의 명령이 현재 저장소에서 실제로 동작한다.

## 법률·브랜드

- [ ] 코드 라이선스와 Frameflow 브랜드 권리를 분리해 명시한다.
- [ ] 제3자 dependency와 sample asset 라이선스를 확인한다.
- [ ] 실제 provider 약관·endpoint를 공개 기본 경로로 강제하지 않는다.

## 최종 명령

```bash
npm install
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

`public:check`가 실패하면 공개하지 않는다. 발견값을 부분 마스킹하지 말고 파일을 제거하거나 중립 placeholder로 교체한다.
