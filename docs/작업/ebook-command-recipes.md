# Ebook형 카메라 커맨드 조합 확장

상태: 후보

## 목적

ebook 홍보 캐러셀에서 확인한 카메라·렌즈·조명·환경 조합을 Frameflow의 COMMAND 노드 하나에 여러 코드로 저장하고, 자연어 planner가 기존 catalog 규칙 안에서 선택하게 한다.

## 확인된 후보 조합

- `/FISHEYE /CLOSEUP /FLASH`
- `/OVERHEADCROWDFLOW`
- `/POV /WIDE /MOTIONBLUR`
- `/RAIN /NIGHTFLASH /MOTIONBLUR`
- `/FOREGROUNDOBJECT /TELEPHOTO /CANDID`
- `/ELEVATORCCTV /FISHEYE /TIMESTAMP`

## 현재 catalog 확인

이미 지원: `FISHEYE`, `CLOSEUP`, `RAIN`, `TELEPHOTO`, `CANDID`

아직 지원하지 않음: `FLASH`, `OVERHEADCROWDFLOW`, `POV`, `WIDE`, `MOTIONBLUR`, `NIGHTFLASH`, `FOREGROUNDOBJECT`, `ELEVATORCCTV`, `TIMESTAMP`

## 범위

- 누락 command code를 적절한 catalog category에 추가
- 각 code의 한국어 label과 provider용 use 설명 추가
- ebook형 6개 조합을 `recipes`에 추가
- COMMAND 하나에 여러 코드가 들어가고 이미지 작업은 하나인 규칙 유지
- planner 자연어 예시와 command combination 회귀 테스트 추가
- 390px/데스크톱 COMMAND node UI에서 긴 조합 overflow 확인

## 비범위

- 외부 서비스의 공식 slash command라고 주장하지 않음
- ebook의 브랜드명·로고·문구 복제
- provider 인증 또는 유료 이미지 생성 E2E

## Acceptance criteria

- catalog 밖 코드는 계속 거부된다.
- 6개 recipe의 모든 code가 catalog에 존재한다.
- 각 recipe는 단일 COMMAND node prompt로 validate된다.
- scene prose는 PROMPT로 분리된다.
- `npm test`, `npm run typecheck`, `npm run build` 통과
- 실제 브라우저에서 명령어 chip/노드가 잘리고 넘치지 않는다.
